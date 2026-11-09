// One-time export of the live bitz.ge WordPress content (EN site + GE multisite at /ge/) through the public REST API.
// Writes raw JSON per type and language into content/wp-export/<lang>/, and downloads every referenced media file
// (featured images, inline <img>/<source>/<video>/<a href> to uploads) into content/wp-export/media/ keeping the uploads path.
// usage: node tools/export-wp.mjs            (run from the newsite folder)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('content/wp-export');
const SITES = { en: 'https://bitz.ge', ge: 'https://bitz.ge/ge' };
const TYPES = [
  ['pages', 'pages'], ['posts', 'posts'], ['colega_portfolio', 'portfolio'], ['colega_shot', 'shots'],
  ['categories', 'categories'], ['tags', 'tags'], ['portfolio_category', 'portfolio_category'], ['media', 'media'],
];
const UA = { 'user-agent': 'Mozilla/5.0 (bitz-site export)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getAll(base, rest) {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const url = `${base}/wp-json/wp/v2/${rest}?per_page=100&page=${page}&_embed=1&context=view`;
    const res = await fetch(url, { headers: UA });
    if (res.status === 400 || res.status === 404) break;             // past the last page, or the type does not exist on this site
    if (!res.ok) { console.log('  !', rest, res.status, await res.text().then(t => t.slice(0, 120))); break; }
    const items = await res.json();
    if (!Array.isArray(items) || !items.length) break;
    out.push(...items);
    const total = +res.headers.get('x-wp-totalpages') || 1;
    if (page >= total) break;
    await sleep(150);
  }
  return out;
}

const mediaUrls = new Set();
const UPLOAD_RE = /https?:\/\/bitz\.ge\/(?:ge\/)?wp-content\/uploads\/[^"'\s)<>]+/g;
function harvest(obj) {
  const s = JSON.stringify(obj);
  for (const m of s.matchAll(UPLOAD_RE)) mediaUrls.add(m[0].replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/\\+$/, ''));   // JSON-escaped quotes left a trailing backslash on some URLs
}

fs.mkdirSync(ROOT, { recursive: true });
const summary = {};
for (const [lang, base] of Object.entries(SITES)) {
  fs.mkdirSync(path.join(ROOT, lang), { recursive: true });
  summary[lang] = {};
  for (const [rest, name] of TYPES) {
    const items = await getAll(base, rest);
    fs.writeFileSync(path.join(ROOT, lang, `${name}.json`), JSON.stringify(items, null, 1));
    summary[lang][name] = items.length;
    harvest(items);
    console.log(`${lang} ${name}: ${items.length}`);
  }
}

// media: keep the original uploads path; skip WordPress' generated size variants when the original is also referenced
const mediaDir = path.join(ROOT, 'media');
fs.mkdirSync(mediaDir, { recursive: true });
const urls = [...mediaUrls].filter(u => !/-\d+x\d+\.(jpe?g|png|webp|gif)$/i.test(u) || !mediaUrls.has(u.replace(/-\d+x\d+(\.[a-z]+)$/i, '$1')));
let got = 0, skipped = 0, failed = 0, bytes = 0;
for (const u of urls) {
  const rel = u.replace(/^https?:\/\/bitz\.ge\/(ge\/)?wp-content\/uploads\//, m => (m.includes('/ge/') ? 'ge/' : '')).split('?')[0];
  const file = path.join(mediaDir, rel);
  if (fs.existsSync(file)) { skipped++; continue; }
  try {
    const res = await fetch(u, { headers: UA });
    if (!res.ok) { failed++; console.log('  miss', res.status, u); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buf); got++; bytes += buf.length;
  } catch (e) { failed++; console.log('  err', u, e.message); }
  await sleep(60);
}
summary.media = { referenced: mediaUrls.size, downloaded: got, skipped, failed, mb: +(bytes / 1048576).toFixed(1) };
fs.writeFileSync(path.join(ROOT, 'summary.json'), JSON.stringify({ exported: new Date().toISOString(), ...summary }, null, 2));
console.log(JSON.stringify(summary));
