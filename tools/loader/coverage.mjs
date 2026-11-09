// coverage.mjs - checks that the writing strokes (strokes.mjs) fully cover each logo shape once written, and draws an overlay:
// the logo in grey, the strokes in colour, any letter area no stroke reaches in red.   usage: node tools/loader/coverage.mjs <out.png>
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { STROKES } from './strokes.mjs';
const require = createRequire(import.meta.url);
const sharp = require('C:/Users/luka_/bitz-agents/tools/node_modules/sharp');
const SVG = fs.readFileSync(new URL('../../assets/img/logo.svg', import.meta.url), 'utf8');
const paths = [...SVG.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
const K = 4, W = Math.ceil(345.87 * K), H = Math.ceil(255.4 * K);
const line = s => `<polyline points="${s.pts.map(p => p.map(v => v * K).join(',')).join(' ')}" fill="none" stroke="#fff" stroke-width="${s.w * K}" stroke-linecap="round" stroke-linejoin="round"/>`;
const raster = async body => (await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#000"/>${body}</svg>`)).greyscale().raw().toBuffer());
const report = [];
const red = Buffer.alloc(W * H);
for (let i = 0; i < paths.length; i++) {
  const shape = await raster(`<g transform="scale(${K})"><path d="${paths[i]}" fill="#fff"/></g>`);
  const mask = await raster(STROKES.filter(s => s.shape === i).map(line).join(''));
  let area = 0, miss = 0;
  for (let p = 0; p < shape.length; p++) if (shape[p] > 127) { area++; if (mask[p] < 127) { miss++; red[p] = 255; } }
  report.push(`shape ${i}: ${(100 * miss / area).toFixed(2)} % uncovered (${miss} px of ${area})`);
}
console.log(report.join('\n'));
const out = process.argv[2];
if (out) {
  const cols = ['#ff5050', '#50c8ff', '#ffd24a', '#7dff7d', '#ff7dff'];
  const over = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#111"/>`
    + `<g transform="scale(${K})">${paths.map(d => `<path d="${d}" fill="#555"/>`).join('')}</g>`
    + STROKES.map(s => line(s).replace('stroke="#fff"', `stroke="${cols[s.shape]}" stroke-opacity=".35"`)).join('')
    + STROKES.map(s => `<polyline points="${s.pts.map(p => p.map(v => v * K).join(',')).join(' ')}" fill="none" stroke="${cols[s.shape]}" stroke-width="3"/>`).join('') + '</svg>';
  const base = await sharp(Buffer.from(over)).removeAlpha().raw().toBuffer();
  for (let p = 0; p < red.length; p++) if (red[p]) { base[p * 3] = 255; base[p * 3 + 1] = 0; base[p * 3 + 2] = 0; }
  await sharp(base, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
}
