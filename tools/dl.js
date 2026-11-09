const https=require('https'),fs=require('fs'),path=require('path');
const sharp=require('C:/Users/luka_/bitz-agents/tools/node_modules/sharp');
const out=path.join(__dirname,'..','assets','img');
const map=JSON.parse(process.argv[2]);
function get(u){return new Promise((res,rej)=>{https.get(u,{headers:{'User-Agent':'Mozilla/5.0'}},r=>{if(r.statusCode>=300&&r.statusCode<400&&r.headers.location)return get(new URL(r.headers.location,u).href).then(res,rej);if(r.statusCode!==200)return rej(new Error(r.statusCode+' '+u));const c=[];r.on('data',d=>c.push(d));r.on('end',()=>res(Buffer.concat(c)));}).on('error',rej);});}
(async()=>{for(const [k,u] of Object.entries(map)){try{const b=await get(u);const img=sharp(b).rotate();const m=await img.metadata();await img.resize({width:Math.min(1600,m.width),withoutEnlargement:true}).webp({quality:82}).toFile(path.join(out,k+'.webp'));const s=fs.statSync(path.join(out,k+'.webp')).size;console.log('ok',k,m.width+'x'+m.height,'->',Math.round(s/1024)+'KB');}catch(e){console.log('FAIL',k,e.message);}}})();
