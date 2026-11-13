// favicons from the logo (assets/img/logo.svg). Run locally once the logo changes: node tools/icons.mjs
//   assets/icons/favicon.svg        the mark alone, black on light tabs and white on dark ones (Chrome, Firefox, Edge)
//   favicon.ico                     white mark in a black disc at 16 and 32 (Safari and anything that ignores SVG icons; reads on any tab bar)
//   assets/icons/apple-touch-icon.png   180 px, white mark on black (iOS rounds the corners itself)
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
let sharp; try { sharp = req('sharp'); } catch { sharp = req('C:/Users/luka_/bitz-agents/tools/node_modules/sharp'); }
const SITE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..');
const logo = fs.readFileSync(path.join(SITE, 'assets/img/logo.svg'), 'utf8');
const [, vb] = logo.match(/viewBox="([^"]+)"/); const [, , LW, LH] = vb.split(/\s+/).map(Number);
const paths = logo.slice(logo.indexOf('>', logo.indexOf('<svg')) + 1, logo.lastIndexOf('</svg>'));
const mark = (S, w, fill, bg) => { const k = w / LW, x = (S - LW * k) / 2, y = (S - LH * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${bg}<g transform="translate(${x} ${y}) scale(${k})" fill="${fill}">${paths}</g></svg>`; };
const out = p => path.join(SITE, p); fs.mkdirSync(out('assets/icons'), { recursive: true });
const disc = S => `<circle cx="${S / 2}" cy="${S / 2}" r="${S / 2}" fill="#000"/>`;
const png = (svg, S) => sharp(Buffer.from(svg), { density: 384 }).resize(S, S).png({ compressionLevel: 9, palette: false }).toBuffer();
// scheme-aware vector icon: the bare mark, centred in a square
fs.writeFileSync(out('assets/icons/favicon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><style>path{fill:#000}@media(prefers-color-scheme:dark){path{fill:#fff}}</style><g transform="translate(${(400 - LW * 1.08) / 2} ${(400 - LH * 1.08) / 2}) scale(1.08)">${paths}</g></svg>`);
const p32 = await png(mark(32, 32 * .76, '#fff', disc(32)), 32), p16 = await png(mark(16, 16 * .78, '#fff', disc(16)), 16);
fs.writeFileSync(out('assets/icons/apple-touch-icon.png'), await png(mark(180, 180 * .7, '#fff', `<rect width="180" height="180" fill="#000"/>`), 180));
// .ico holding the PNGs (every current browser reads PNG-in-ICO)
const imgs = [[16, p16], [32, p32]]; const hdr = Buffer.alloc(6); hdr.writeUInt16LE(0, 0); hdr.writeUInt16LE(1, 2); hdr.writeUInt16LE(imgs.length, 4);
let off = 6 + 16 * imgs.length; const dirs = imgs.map(([s, b]) => { const d = Buffer.alloc(16); d[0] = s; d[1] = s; d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(b.length, 8); d.writeUInt32LE(off, 12); off += b.length; return d; });
fs.writeFileSync(out('favicon.ico'), Buffer.concat([hdr, ...dirs, ...imgs.map(x => x[1])]));
for (const f of ['assets/icons/favicon.svg', 'assets/icons/apple-touch-icon.png', 'favicon.ico']) console.log(f, fs.statSync(out(f)).size, 'bytes');
