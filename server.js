const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const BASE = (process.env.FULCRUM_BASE_URL || 'https://api.fulcrumpro.com').replace(/\/$/, '');
const TOKEN = process.env.FULCRUM_API_TOKEN || '';
const PASSWORD = process.env.APP_PASSWORD || '';
const TIME_ZONE = process.env.FULCRUM_TIME_ZONE || '';
const WEB_ROOT = path.join(__dirname, 'public');
const BATCH_SIZE = 5000, MAX_ROWS = 100000, SESSION_MS = 12 * 60 * 60 * 1000;
const ROUTES = new Set(['/api/reporting/job-activity/list','/api/jobs/list','/api/sales-orders/list','/api/work-centers/list','/api/reporting/sales-order-lines/list']);
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const sessions = new Map(), attempts = new Map();
if (process.env.NODE_ENV === 'production' && !PASSWORD) throw new Error('APP_PASSWORD is required in production.');
function send(res,status,value,headers={}) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(value)); }
function safeEqual(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function cookieValue(req,name){const raw=req.headers.cookie||'';for(const pair of raw.split(';')){const i=pair.indexOf('=');if(i>0&&pair.slice(0,i).trim()===name)return decodeURIComponent(pair.slice(i+1).trim());}return '';}
function sessionId(req){const id=cookieValue(req,'report_session');const expires=sessions.get(id);if(!id||!expires)return '';if(expires<Date.now()){sessions.delete(id);return '';}return id;}
function isSecure(req){return req.headers['x-forwarded-proto']==='https'||req.socket.encrypted;}
function cookieOptions(req,maxAge){return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`+(isSecure(req)?'; Secure':'');}
function authenticated(req){return Boolean(sessionId(req));}
async function readJson(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>1024*1024)throw Error('Request body is too large.');chunks.push(c);}if(!chunks.length)return {};const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Request body must be a JSON object.');return value;}
async function proxyList(res,route,body){if(!TOKEN)return send(res,503,{error:'FULCRUM_API_TOKEN is not configured.'});const rows=[];try{for(let skip=0;skip<MAX_ROWS;skip+=BATCH_SIZE){const url=new URL(BASE+route);url.searchParams.set('Skip',String(skip));url.searchParams.set('Take',String(BATCH_SIZE));const upstream=await fetch(url,{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+TOKEN},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});const raw=await upstream.text();let data;try{data=raw?JSON.parse(raw):null;}catch(_){data={message:raw.slice(0,1000)};}if(!upstream.ok)return send(res,upstream.status,{error:'Fulcrum API request failed.',status:upstream.status,detail:data});if(!Array.isArray(data)&&data&&Array.isArray(data.data))data=data.data;if(!Array.isArray(data))return send(res,502,{error:'Fulcrum returned an unexpected list response.',detail:data});rows.push(...data);if(data.length<BATCH_SIZE)return send(res,200,rows);}return send(res,502,{error:`Fulcrum returned more than ${MAX_ROWS} rows. Narrow the report filters and retry.`});}catch(error){return send(res,502,{error:'Could not reach Fulcrum.',detail:error.message,retryable:true});}}
function serveStatic(req,res,pathname){let decoded;try{decoded=decodeURIComponent(pathname);}catch(_){res.writeHead(400);return res.end('Invalid URL');}if(decoded==='/')decoded='/index.html';const file=path.resolve(WEB_ROOT,'.'+decoded);if(file!==path.join(WEB_ROOT,'index.html')&&!file.startsWith(WEB_ROOT+path.sep)){res.writeHead(403);return res.end('Forbidden');}fs.readFile(file,(err,content)=>{if(err){res.writeHead(404);return res.end('Not found');}res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);});}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true});if(req.method==='GET'&&url.pathname==='/api/session')return send(res,200,{authenticated:authenticated(req)});if(req.method==='POST'&&url.pathname==='/auth/login'){try{const {password=''}=await readJson(req);const ip=req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown';const now=Date.now();let entry=attempts.get(ip);if(!entry||entry.until<now)entry={count:0,until:now+15*60*1000};if(entry.count>=10){attempts.set(ip,entry);return send(res,429,{error:'Too many password attempts. Try again in 15 minutes.'});}if(!PASSWORD||!safeEqual(String(password),PASSWORD)){entry.count++;attempts.set(ip,entry);return send(res,401,{error:'Incorrect password.'});}attempts.delete(ip);const id=crypto.randomBytes(32).toString('hex');sessions.set(id,now+SESSION_MS);return send(res,200,{ok:true},{'Set-Cookie':`report_session=${id}; ${cookieOptions(req,SESSION_MS/1000)}`});}catch(error){return send(res,400,{error:error.message});}}
if(req.method==='POST'&&url.pathname==='/auth/logout'){const id=sessionId(req);if(id)sessions.delete(id);return send(res,200,{ok:true},{'Set-Cookie':`report_session=; ${cookieOptions(req,0)}`});}
if(url.pathname.startsWith('/api/')&&url.pathname!=='/api/session'&&!authenticated(req))return send(res,401,{error:'Enter the report password to view data.'});
if(req.method==='GET'&&url.pathname==='/api/config')return send(res,200,{timeZone:TIME_ZONE});
if(req.method==='POST'&&ROUTES.has(url.pathname)){try{return await proxyList(res,url.pathname,await readJson(req));}catch(error){return send(res,400,{error:error.message});}}
if(req.method!=='GET'){res.writeHead(405,{'Allow':'GET, POST'});return res.end('Method not allowed');}
return serveStatic(req,res,url.pathname);});
server.listen(PORT,HOST,()=>console.log(`Due Today by Operation listening on ${HOST}:${PORT}`));

