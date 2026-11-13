#!/usr/bin/env node
"use strict";
/**
 * Webcloner public-site capture runner. Playwright records browser-loaded assets
 * and browses public same-site links. A separate unauthenticated HTTP fetcher
 * discovers static public files referenced inside captured bundles.
 *
 * Deliberately NO credentials, POST automation, anti-bot bypass, or paywall access.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const robotsParser = require("robots-parser");

const UA = "WebclonerPublicCapture/1.0";
const MB = 1024 * 1024;
const STATIC_EXT = /\.(?:js|mjs|css|wasm|png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|eot|wav|mp3|ogg|m4a|mp4|webm|mov|json|webmanifest|txt|xml|pdf|zip|map)(?:$|\?)/i;
const MEDIA_TYPE = /^(?:image\/|audio\/|video\/|font\/)|javascript|css|wasm|pdf|zip|octet-stream/i;
const SENSITIVE_PATH = /(?:^|\/)(?:logout|signout|delete|remove-account|checkout|payment|billing|account|session|token|private|admin)(?:\/|$)/i;
const SENSITIVE_QUERY = /^(?:access_token|refresh_token|auth|authorization|api_key|apikey|token|secret|password|session|signature|sig|jwt)$/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => crypto.createHash("sha256").update(value).digest("hex").slice(0, 10);
const isInteger = value => /^\d+$/.test(String(value));
function bounded(value, name, min, max) {
  if (!isInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error(name + " must be a number between " + min + " and " + max);
  return Number(value);
}
function parseArgs(argv) {
  if (!argv.length) throw new Error("A URL is required.");
  const input = new URL(argv[0]);
  if (!["http:", "https:"].includes(input.protocol) || input.username || input.password)
    throw new Error("Only ordinary http(s) URLs without credentials are supported.");
  const config = {
    input: input.href, host: input.hostname.toLowerCase(), out: null,
    maxPages:40, maxDepth:3, maxAssets:2500, maxTotalMB:800,
    maxFileMB:35, delayMS:700, subdomains:false, thirdParty:false,
    deepAssets:true, sitemap:true, screenshots:true, resume:false
  };
  const values = {
    "--out":["out",null,null], "--max-pages":["maxPages",1,500],
    "--max-depth":["maxDepth",0,8], "--max-assets":["maxAssets",1,20000],
    "--max-total-mb":["maxTotalMB",1,5000], "--max-file-mb":["maxFileMB",1,250],
    "--delay-ms":["delayMS",0,60000]
  };
  const switches = {
    "--include-subdomains":["subdomains",true],
    "--third-party-assets":["thirdParty",true],
    "--no-deep-assets":["deepAssets",false],
    "--no-sitemap":["sitemap",false],
    "--no-screenshots":["screenshots",false],
    "--resume":["resume",true]
  };
  for (let i=1; i<argv.length; i++) {
    const flag = argv[i];
    if (flag in switches) { const [name,value]=switches[flag]; config[name]=value; }
    else if (flag in values) {
      const [name,min,max]=values[flag], raw=argv[++i];
      if (raw===undefined) throw new Error("Missing value after " + flag);
      config[name]=name==="out"?path.resolve(raw):bounded(raw,flag,min,max);
    } else throw new Error("Unknown argument: " + flag);
  }
  if(config.resume && !config.out)throw new Error("--resume requires --out with the existing capture folder.");
  if (!config.out) {
    const stamp=new Date().toISOString().replace(/[:.]/g,"-");
    config.out=path.resolve("captures",config.host.replace(/[^a-z0-9.-]/gi,"_")+"-"+stamp);
  }
  if (config.maxFileMB>config.maxTotalMB)config.maxFileMB=config.maxTotalMB;
  return config;
}

const config=parseArgs(process.argv.slice(2));
const rootDir=config.out, siteDir=path.join(rootDir,"site");
fs.mkdirSync(siteDir,{recursive:true});
const byteLimit=config.maxTotalMB*MB, singleFileLimit=config.maxFileMB*MB;
let totalBytes=0, assetsSaved=0, blockedRobots=0;
let runStartPages=0,runStartAssets=0,runStartBytes=0,stopRequested=false,canPersist=false;
const checkpointFile=path.join(rootDir,"checkpoint.json");
let browser=null, context=null;
const manifest=[], pages=[], errors=[], visited=new Set(), queued=new Set();
const queue=[], savedUrls=new Set(), recording=new Set(), pending=new Set();
const fileOwners=new Map(), discoveredAssets=new Set(), robotRules=new Map();
const baseHost=config.host.replace(/^www\./,"");
const runAssets=()=>assetsSaved-runStartAssets;
const runBytes=()=>totalBytes-runStartBytes;
const budgetReached=()=>runAssets()>=config.maxAssets || runBytes()>=byteLimit;
function atomicJSON(file,value) {
  const temp=file+".tmp-"+process.pid;
  fs.writeFileSync(temp,JSON.stringify(value,null,2));
  fs.renameSync(temp,file);
}
const robotsUrlOf=u=>u.protocol+"//"+u.host+"/robots.txt";

function withinSite(u) {
  const hostname=u.hostname.toLowerCase();
  if (hostname===baseHost || hostname==="www."+baseHost) return true;
  return config.subdomains && hostname.endsWith("."+baseHost);
}
function publicUrl(url) {
  try {
    const u=new URL(url);
    if (!["http:","https:"].includes(u.protocol) || u.username || u.password) return null;
    if (u.hash)u.hash="";
    if (SENSITIVE_PATH.test(u.pathname))return null;
    for (const key of u.searchParams.keys())if(SENSITIVE_QUERY.test(key))return null;
    return u;
  } catch{return null;}
}
function isPage(u) {
  if (!withinSite(u))return false;
  if (STATIC_EXT.test(u.pathname))return false;
  if (/\.(?:exe|dmg|apk|deb|rpm|tar|gz|7z|rar|csv|bin)(?:$|\?)/i.test(u.pathname))return false;
  if (u.pathname.startsWith("/api/") || /(?:^|\/)(?:graphql|rpc|__data\.json)(?:\/|$)/i.test(u.pathname))return false;
  return true;
}
function enqueue(value,depth=0,base=config.input) {
  if (queue.length>=config.maxPages*30 || depth>config.maxDepth)return;
  const u=publicUrl(new URL(value,base).href);
  if (!u || !isPage(u))return;
  if (!queued.has(u.href) && !visited.has(u.href)) {
    queued.add(u.href);queue.push({url:u.href,depth});
  }
}
function sanitize(segment) {
  let s;
  try{s=decodeURIComponent(segment);}catch{s=segment;}
  s=s.replace(/[^\w.@()+~-]/g,"_").replace(/^\.+$/,"_");
  return (s||"_").slice(0,115);
}
function outputPath(value,mime,isDocument=false) {
  const u=new URL(value);
  const host=u.hostname.toLowerCase();
  const extra=host===config.host?[]:["_hosts",sanitize(host)];
  const pieces=u.pathname.split("/").filter(Boolean).map(sanitize);
  let final=pieces.pop()||"";
  if (isDocument) {
    if (!final) final="index.html";
    else if (!/\.(?:html?|xhtml)$/i.test(final)) {
      if (/\.[a-z0-9]{2,8}$/i.test(final))final+=".html";
      else {pieces.push(final);final="index.html";}
    }
  } else {
    if (!final)final="index";
    if (!/\.[a-z0-9]{1,10}$/i.test(final)) {
      const type=(mime||"").toLowerCase();
      const extension=type.includes("json")?".json":type.includes("css")?".css":
        type.includes("javascript")?".js":type.includes("html")?".html":
        type.includes("wasm")?".wasm":type.includes("svg")?".svg":
        type.includes("png")?".png":type.includes("jpeg")?".jpg":
        type.includes("woff2")?".woff2":type.includes("pdf")?".pdf":".bin";
      final+=extension;
    }
  }
  if (u.search) {
    const ext=path.extname(final),stem=final.slice(0,final.length-ext.length);
    final=stem+"__q_"+sha(u.search)+ext;
  }
  const rel=path.join("site",...extra,...pieces,final);
  const target=path.resolve(rootDir,rel);
  if (!target.startsWith(rootDir+path.sep))throw new Error("Unsafe capture path");
  return {rel:rel.split(path.sep).join("/"),full:target};
}
function writeFile(full,body) {
  fs.mkdirSync(path.dirname(full),{recursive:true});
  fs.writeFileSync(full,body);
}
function makeEntry(url,body,mime,status,via,isDocument=false) {
  if (savedUrls.has(url) || recording.has(url))return false;
  if (runAssets()>=config.maxAssets || runBytes()+body.length>byteLimit || body.length>singleFileLimit)return false;
  const file=outputPath(url,mime,isDocument);
  let rel=file.rel,full=file.full;
  if (fileOwners.has(rel) && fileOwners.get(rel)!==url) {
    const suffix="__"+sha(url);
    const ext=path.extname(full);full=full.slice(0,-ext.length)+suffix+ext;
    rel=path.relative(rootDir,full).split(path.sep).join("/");
  }
  writeFile(full,body);
  savedUrls.add(url);fileOwners.set(rel,url);totalBytes+=body.length;assetsSaved++;
  manifest.push({url,local:rel,bytes:body.length,type:mime||null,status,via});
  return true;
}
async function robots(u) {
  const base=u.protocol+"//"+u.host;
  if (robotRules.has(base))return robotRules.get(base);
  let text="";
  try {
    const response=await fetch(robotsUrlOf(u),{
      signal:AbortSignal.timeout(9500),headers:{"User-Agent":UA}
    });
    if (response.ok)text=(await response.text()).slice(0,600000);
  } catch(err) {
    errors.push({kind:"robots",url:base,reason:String(err.message||err)});
  }
  const parser=robotsParser(robotsUrlOf(u),text);
  const result={parser,text};
  robotRules.set(base,result);
  return result;
}
async function allowed(u) {
  const entry=await robots(u);
  const ok=entry.parser.isAllowed(u.href,UA)!==false;
  if (!ok)blockedRobots++;
  return ok;
}
async function record(response) {
  try {
    const request=response.request();
    if (request.method()!=="GET" || response.status()!==200)return;
    const actual=publicUrl(response.url());
    if (!actual)return;
    const same=withinSite(actual);
    const mime=(response.headers()["content-type"]||"").split(";")[0].toLowerCase();
    const type=request.resourceType();
    if (type==="document")return; // hydrated page DOM is captured separately
    const staticResource=STATIC_EXT.test(actual.pathname) ||
      ["image","stylesheet","font","script","media"].includes(type) ||
      MEDIA_TYPE.test(mime);
    if (!same && (!config.thirdParty || !staticResource))return;
    if (savedUrls.has(actual.href) || recording.has(actual.href))return;
    if (budgetReached())return;
    const len=Number(response.headers()["content-length"]||0);
    if (len>singleFileLimit || (len && len+runBytes()>byteLimit))return;
    if (!(await allowed(actual)))return;
    recording.add(actual.href);
    try {
      const body=await response.body();
      if (body.length && body.length<=singleFileLimit) {
        makeEntry(actual.href,body,mime,response.status(),"browser");
      }
    } finally {recording.delete(actual.href);}
  } catch(err) {
    errors.push({kind:"resource",url:response.url(),reason:String(err.message||err)});
  }
}
function scheduleResponse(response) {
  if (pending.size>300)return;
  const task=record(response);
  pending.add(task);
  task.finally(()=>pending.delete(task)).catch(()=>{});
}
async function readText(url,limit=2*MB) {
  const u=publicUrl(url);if (!u || !withinSite(u) || !(await allowed(u)))return null;
  try {
    const res=await fetch(u.href,{
      headers:{"User-Agent":UA},signal:AbortSignal.timeout(12000)
    });
    if (!res.ok)return null;
    const size=Number(res.headers.get("content-length")||0);
    if (size>limit)return null;
    const body=Buffer.from(await res.arrayBuffer());
    return body.length<=limit?body.toString("utf8"):null;
  } catch{return null;}
}
async function discoverSitemaps() {
  if (!config.sitemap)return;
  const entry=await robots(new URL(config.input));
  const urls=[new URL("/sitemap.xml",config.input).href];
  for (const line of entry.text.split(/\r?\n/)) {
    const m=line.match(/^\s*Sitemap:\s*(https?:\/\/\S+)/i);
    if (m)urls.push(m[1]);
  }
  const discovered=new Set(),toRead=urls.slice(0,10);
  while (toRead.length && discovered.size<20) {
    const url=toRead.shift();
    if (discovered.has(url))continue;
    discovered.add(url);
    const xml=await readText(url);
    if (!xml)continue;
    const tags=[...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].slice(0,4000);
    for (const match of tags) {
      const url=match[1].replace(/&amp;/g,"&");
      if (/\.xml(?:$|\?)/i.test(url)) {
        if (!discovered.has(url) && toRead.length<20)toRead.push(url);
      } else enqueue(url,1);
    }
  }
  console.log("[webcloner] Sitemap URLs queued: " + queue.length);
}
function collectStaticRefs(text,from) {
  if (!text || text.length>8*MB)return;
  const rx=/(?:https?:\/\/|\/|\.\/|\.\.\/)[a-z0-9_@.:%~+\-/?=&]+?\.(?:js|mjs|css|wasm|png|jpe?g|gif|webp|avif|ico|svg|woff2?|ttf|otf|eot|wav|mp3|ogg|m4a|mp4|webm|json|webmanifest|pdf|map)(?:\?[a-z0-9_%.=&+\-]+)?/gi;
  for (const match of text.matchAll(rx)) {
    if (discoveredAssets.size>config.maxAssets*3)break;
    try {
      const u=publicUrl(new URL(match[0],from).href);
      if (u && withinSite(u) && STATIC_EXT.test(u.pathname))discoveredAssets.add(u.href);
    } catch{}
  }
}
async function downloadDiscovered(url) {
  const u=publicUrl(url);if(!u||!withinSite(u) || savedUrls.has(u.href))return;
  if (assetsSaved>=config.maxAssets || totalBytes>=byteLimit)return;
  if (!(await allowed(u)))return;
  try {
    const resp=await fetch(u.href,{headers:{"User-Agent":UA},signal:AbortSignal.timeout(14000)});
    const actual=publicUrl(resp.url);
    if (!resp.ok || resp.status!==200 || !actual || !withinSite(actual)) {
      await resp.body?.cancel();
      return;
    }
    const mime=(resp.headers.get("content-type")||"").split(";")[0].toLowerCase();
    if (!STATIC_EXT.test(actual.pathname) && !MEDIA_TYPE.test(mime)) {
      await resp.body?.cancel();return;
    }
    const length=Number(resp.headers.get("content-length")||0);
    if (length>singleFileLimit || length+runBytes()>byteLimit) {
      await resp.body?.cancel();return;
    }
    const chunks=[];let lengthRead=0;
    if (!resp.body)return;
    const reader=resp.body.getReader();
    while(true) {
      const {value,done}=await reader.read();
      if(done)break;
      lengthRead+=value.length;
      if (lengthRead>singleFileLimit || lengthRead+runBytes()>byteLimit) {
        await reader.cancel();return;
      }
      chunks.push(Buffer.from(value));
    }
    makeEntry(actual.href,Buffer.concat(chunks),mime,200,"static-reference");
  } catch(err) {
    errors.push({kind:"deep-asset",url,reason:String(err.message||err)});
  }
}
async function visit(entry,index) {
  const {url,depth}=entry;
  const u=publicUrl(url);
  if(!u||!isPage(u)||!(await allowed(u)))return;
  console.log("[webcloner] Page "+index+" (batch "+(index-runStartPages)+"/"+config.maxPages+") depth "+depth+": "+u.href);
  const page=await context.newPage();
  page.on("response",scheduleResponse);
  page.on("pageerror",err=>{
    if(errors.length<300)errors.push({kind:"browser",url:u.href,reason:String(err.message||err)});
  });
  const item={url:u.href,depth,status:null,title:null,links:0,finalUrl:null};
  try {
    const nav=await page.goto(u.href,{waitUntil:"domcontentloaded",timeout:30000});
    if(nav)item.status=nav.status();
    const final=publicUrl(page.url());
    if(!final||!withinSite(final)) {
      item.error="Redirected out of capture scope";
      return;
    }
    item.finalUrl=final.href;
    if(!nav || !nav.ok()) {
      item.error="Navigation HTTP status: "+(item.status||"unknown");
      return;
    }
    await page.waitForLoadState("networkidle",{timeout:3500}).catch(()=>{});
    for(let n=1;n<=3;n++) {
      await page.evaluate(frac=>window.scrollTo(0,document.documentElement.scrollHeight*frac/3),n).catch(()=>{});
      await page.waitForTimeout(250);
    }
    await page.evaluate(()=>window.scrollTo(0,0)).catch(()=>{});
    await page.waitForTimeout(450);
    item.title=await page.title().catch(()=>"");
    const links=await page.locator("a[href]").evaluateAll(nodes=>nodes.map(x=>x.href)).catch(()=>[]);
    item.links=links.length;
    for(const href of links) {
      try {
        if (STATIC_EXT.test(new URL(href).pathname)) {
          const asset=publicUrl(href);
          if(asset && withinSite(asset))discoveredAssets.add(asset.href);
        } else enqueue(href,depth+1,final.href);
      } catch{}
    }
    const html=await page.content();
    if(Buffer.byteLength(html)<singleFileLimit){
      // Save the real DOM as an HTML snapshot, never account-only content.
      if (!savedUrls.has(final.href)) {
        const b=Buffer.from(html,"utf8");
        makeEntry(final.href,b,"text/html",item.status,"hydrated-dom",true);
      }
    }
    if(config.screenshots && index<=10){
      const file=path.join(rootDir,"screenshots",String(index).padStart(3,"0")+"-"+sha(final.href)+".png");
      fs.mkdirSync(path.dirname(file),{recursive:true});
      await page.screenshot({path:file,fullPage:true,timeout:14000}).catch(()=>{});
    }
  } catch(err) {
    item.error=String(err.message||err);
    errors.push({kind:"page",url:u.href,reason:item.error});
  } finally {
    pages.push(item);
    await Promise.allSettled([...pending]);
    await page.close().catch(()=>{});
  }
}
async function deepScan() {
  if(!config.deepAssets)return;
  const captured=manifest.filter(e=>/\.(?:js|mjs|css|html|json)(?:$|__q_)/i.test(e.local)||/javascript|css|html|json/.test(e.type||""));
  for(const entry of captured.slice(0,3000)) {
    try {
      const full=path.join(rootDir,entry.local),stat=fs.statSync(full);
      if(stat.size>6*MB)continue;
      const s=fs.readFileSync(full,"utf8");
      collectStaticRefs(s,entry.url);
    } catch{}
  }
  const candidates=[...discoveredAssets].filter(u=>!savedUrls.has(u));
  console.log("[webcloner] Additional public static asset candidates: "+candidates.length);
  let done=0;
  for(const u of candidates){
    if(stopRequested || budgetReached())break;
    if(done++>config.maxAssets)break;
    await downloadDiscovered(u);
    if(done%20===0)await sleep(Math.max(100,config.delayMS));
  }
}
function persist() {
  const data={
    source:config.input,createdAt:new Date().toISOString(),
    limits:{maxPages:config.maxPages,maxDepth:config.maxDepth,maxAssets:config.maxAssets,
      maxTotalMB:config.maxTotalMB,maxFileMB:config.maxFileMB},
    totalBytes,assetsSaved,pagesVisited:pages.length,robotsDisallowed:blockedRobots,
    assets:manifest
  };
  // The queue is committed last: a restart never trusts a checkpoint before
  // its corresponding manifest/pages files have been safely replaced.
  atomicJSON(path.join(rootDir,"manifest.json"),data);
  atomicJSON(path.join(rootDir,"pages.json"),pages);
  atomicJSON(path.join(rootDir,"errors.json"),errors.slice(0,1000));
  atomicJSON(checkpointFile,{
    version:1,source:config.input,updatedAt:new Date().toISOString(),
    visited:[...visited],queue,discoveredAssets:[...discoveredAssets],
    pagesVisited:pages.length,resourcesSaved:assetsSaved
  });
  const summary=[
    "Webcloner public website capture",
    "==============================",
    "Requested URL: "+config.input,
    "Pages visited (total): "+pages.length,
    "Pages visited (this run): "+(pages.length-runStartPages),
    "Remaining queued pages: "+queue.length,
    "Resources saved (total): "+assetsSaved,
    "Bytes saved (total): "+(totalBytes/MB).toFixed(2)+" MiB",
    "Robots exclusions (this run): "+blockedRobots,
    "Page/asset errors: "+errors.length,
    "Output: "+rootDir,
    "Resume: use the same --out directory with --resume.",
    "",
    "Limitations:",
    "- Public HTTP pages and browser-loaded resources only.",
    "- Server-side source code and databases cannot be downloaded by a browser.",
    "- Account-only/paid content, credentials, protected resources and bypasses are excluded.",
    "- Offline hosting is not guaranteed. Rebuild backend routes and APIs independently.",
    "- Some lazy-loaded assets require user interaction and will not appear.",
    "- Respect site licenses, copyright, robots.txt and Terms of Service."
  ].join("\n")+"\n";
  fs.writeFileSync(path.join(rootDir,"report.txt"),summary);
  console.log("\n"+summary);
}
function restore() {
  const manifestPath=path.join(rootDir,"manifest.json");
  const pagesPath=path.join(rootDir,"pages.json");
  if(!config.resume) {
    if(fs.existsSync(manifestPath) || fs.existsSync(checkpointFile))
      throw new Error("Existing capture detected. Add --resume or use a new --out folder.");
    return false;
  }
  if(!fs.existsSync(manifestPath) || !fs.existsSync(pagesPath))
    throw new Error("--resume needs an existing manifest.json and pages.json in --out.");
  const prior=JSON.parse(fs.readFileSync(manifestPath,"utf8"));
  if(new URL(prior.source).href!==new URL(config.input).href)
    throw new Error("Resume source differs from existing capture: "+prior.source);
  if(!Array.isArray(prior.assets))throw new Error("Invalid manifest: assets array missing");
  const oldPages=JSON.parse(fs.readFileSync(pagesPath,"utf8"));
  if(!Array.isArray(oldPages))throw new Error("Invalid pages.json");
  // Reconstruct deduplication and budgets from files on disk, not only counters.
  for(const entry of prior.assets) {
    if(!entry || typeof entry.url!=="string" || typeof entry.local!=="string")continue;
    const file=path.resolve(rootDir,entry.local);
    if(!file.startsWith(rootDir+path.sep) || !fs.existsSync(file))continue;
    const stat=fs.statSync(file);
    if(!stat.isFile())continue;
    manifest.push(entry);
    savedUrls.add(entry.url);
    fileOwners.set(entry.local,entry.url);
    totalBytes+=stat.size;
    assetsSaved++;
  }
  for(const page of oldPages) {
    if(!page || typeof page.url!=="string")continue;
    pages.push(page);
    visited.add(page.url);
  }
  const hasCheckpoint=fs.existsSync(checkpointFile);
  if(hasCheckpoint) {
    const state=JSON.parse(fs.readFileSync(checkpointFile,"utf8"));
    if(state.version!==1 || new URL(state.source).href!==new URL(config.input).href)
      throw new Error("Checkpoint version or target URL mismatch.");
    for(const raw of state.visited||[]) {
      const u=publicUrl(raw);if(u && isPage(u))visited.add(u.href);
    }
    for(const item of state.queue||[]) {
      if(!item || !Number.isInteger(item.depth) || item.depth<0 || item.depth>8)continue;
      const u=publicUrl(item.url);
      if(u && isPage(u) && !visited.has(u.href) && !queued.has(u.href)) {
        queued.add(u.href);queue.push({url:u.href,depth:item.depth});
      }
    }
    for(const raw of state.discoveredAssets||[]) {
      const u=publicUrl(raw);if(u && withinSite(u))discoveredAssets.add(u.href);
    }
    console.log("[webcloner] Restored pending URL queue:",queue.length);
  } else console.log("[webcloner] Older capture found; will recover links from saved HTML and sitemaps.");
  runStartPages=pages.length;
  runStartAssets=assetsSaved;
  runStartBytes=totalBytes;
  console.log("[webcloner] Loaded",pages.length,"previous pages and",assetsSaved,"existing resources.");
  return hasCheckpoint;
}
function recoverLegacyLinks() {
  const depths=new Map();
  for(const page of pages) {
    const depth=Number.isInteger(page.depth)?page.depth:0;
    depths.set(page.url,depth);
    if(page.finalUrl)depths.set(page.finalUrl,depth);
  }
  let scanned=0;
  for(const entry of manifest) {
    if(entry.via!=="hydrated-dom" || !/html/i.test(entry.type||""))continue;
    const src=publicUrl(entry.url),file=path.resolve(rootDir,entry.local);
    if(!src || !withinSite(src) || !file.startsWith(rootDir+path.sep))continue;
    try {
      if(fs.statSync(file).size>8*MB)continue;
      const html=fs.readFileSync(file,"utf8");
      const links=/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1/gi;
      const depth=(depths.get(src.href)??0)+1;
      for(const match of html.matchAll(links)) {
        try{enqueue(match[2].replace(/&amp;/g,"&"),depth,src.href);}catch{}
      }
      scanned++;
    } catch{}
  }
  console.log("[webcloner] Recovered links from",scanned,"saved HTML snapshots; pending:",queue.length);
}
async function archive() {
  const destination=rootDir+".zip",basename=path.basename(rootDir);
  const res=spawnSync("zip",["-q","-r",destination,basename],{
    cwd:path.dirname(rootDir),encoding:"utf8",timeout:180000
  });
  if(!res.error && res.status===0)console.log("[webcloner] Archive: "+destination);
  else console.log("[webcloner] Install zip with: sudo apt install zip (the captured folder is intact)");
}
async function main() {
  console.log("[webcloner] Site: "+config.input);
  console.log("[webcloner] Folder: "+rootDir);
  const hasCheckpoint=restore();
  const root=new URL(config.input);
  if(!(await allowed(root)))throw new Error("robots.txt disallows crawling the target URL.");
  if(!config.resume)enqueue(config.input,0);
  if(!config.resume || !hasCheckpoint) {
    await discoverSitemaps();
    if(config.resume)recoverLegacyLinks();
  }
  // A failure before this point must never overwrite an older capture.
  canPersist=true;
  // Save the pending frontier before visiting any pages.
  persist();
  browser=await chromium.launch({headless:true,args:["--disable-dev-shm-usage"]});
  context=await browser.newContext({
    viewport:{width:1365,height:850},deviceScaleFactor:1,
    acceptDownloads:false,serviceWorkers:"block"
  });
  await context.route("**/*",async route=>{
    const req=route.request();
    if(!["GET","HEAD"].includes(req.method()))return route.abort();
    const url=publicUrl(req.url());
    if(!url)return route.abort();
    return route.continue();
  });
  while(queue.length && !stopRequested &&
        pages.length-runStartPages<config.maxPages && !budgetReached()) {
    const entry=queue.shift();
    if(visited.has(entry.url) || entry.depth>config.maxDepth)continue;
    await visit(entry,pages.length+1);
    visited.add(entry.url);
    // Routine checkpoint plus a final one on exit/interrupt.
    if((pages.length-runStartPages)%5===0)persist();
    if(config.delayMS && !stopRequested)await sleep(config.delayMS);
  }
  await Promise.allSettled([...pending]);
  if(!stopRequested)await deepScan();
}
function requestStop(signal) {
  if(stopRequested)return;
  stopRequested=true;
  process.exitCode=signal==="SIGINT"?130:143;
  console.log("\n[webcloner] "+signal+" received; saving current work and resume checkpoint.");
}
process.on("SIGINT",()=>requestStop("SIGINT"));
process.on("SIGTERM",()=>requestStop("SIGTERM"));
main().catch(err=>{
  console.error("[webcloner] ERROR:",err.message||err);
  errors.push({kind:"fatal",reason:String(err.message||err)});
  process.exitCode=1;
}).finally(async()=>{
  await Promise.allSettled([...pending]);
  if(context)await context.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  if(canPersist){persist();await archive();}
});
