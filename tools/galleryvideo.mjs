// galleryvideo.mjs - finishes the project gallery videos (content/projects/*/project.json, gallery items of type "video"):
//   - a poster <video name>.webp next to the file when the item has none (a representative frame, like the shot bubbles)
//   - an mp4 made from the webm when an item only has a webm (Safari and older phones do not play every webm)
//   node tools/galleryvideo.mjs           make what is missing
//   node tools/galleryvideo.mjs --check   exit 1 if anything is missing (the deploy workflow then installs ffmpeg and runs it)
//   node tools/galleryvideo.mjs --slim    also re-encode mp4s over 6 MB to a web size (max 1600 wide, H.264 crf 24, silent), once per file
//                                         (done files are listed in assets/video/projects/.slimmed so a clip that stays big is not re-encoded again)
// ffmpeg: $FFMPEG, else ../../tools/node_modules/ffmpeg-static (the laptop), else "ffmpeg" on the PATH (CI).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLIM_MB = 6, MAXW = 1600;
const abs = p => path.join(SITE, p.replace(/^\//, ''));
const posterOf = p => p.replace(/\.(mp4|webm)$/i, '.webp');
const LEDGER = path.join(SITE, 'assets/video/projects/.slimmed');
const slimmed = new Set(fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).filter(Boolean) : []);

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const local = path.resolve(SITE, '..', 'tools', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(local) ? local : 'ffmpeg';
}
const run = (ff, args) => spawnSync(ff, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
const mb = f => Math.round(fs.statSync(f).size / 1e6 * 10) / 10;

function jobs() {
  const out = [];
  const dir = path.join(SITE, 'content/projects');
  for (const slug of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const f = path.join(dir, slug, 'project.json'); if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const g of j.en?.gallery || []) {
      if (typeof g !== 'object' || !(g.type === 'video' || g.video || g.webm)) continue;
      const src = [g.video, g.webm].find(p => p && fs.existsSync(abs(p))); if (!src) continue;
      const poster = g.poster || posterOf(g.video || g.webm);
      const item = { slug, file: f, g, src, poster };
      if (!fs.existsSync(abs(poster))) out.push({ ...item, kind: 'poster' });
      if (!g.video && g.webm) { const mp4 = g.webm.replace(/\.webm$/i, '.mp4'); if (!fs.existsSync(abs(mp4))) out.push({ ...item, kind: 'mp4', mp4 }); else if (g.video !== mp4) out.push({ ...item, kind: 'link', mp4 }); }
      if (process.argv.includes('--slim') && g.video && fs.existsSync(abs(g.video)) && mb(abs(g.video)) > SLIM_MB && !slimmed.has(path.basename(g.video))) out.push({ ...item, kind: 'slim' });
    }
  }
  return out;
}

function frameTime(ff, src) {
  const info = run(ff, ['-i', src]).stderr, m = info.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const dur = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 6;
  const a = dur * 0.12, w = Math.max(0.5, Math.min(dur * 0.6, 8));
  const pick = run(ff, ['-ss', a.toFixed(2), '-t', w.toFixed(2), '-i', src, '-an', '-vf', 'fps=6,scale=96:-2,thumbnail=48,showinfo', '-frames:v', '1', '-f', 'null', '-']).stderr;
  const pt = pick.match(/pts_time:([\d.]+)/);
  return Math.min(dur - 0.05, a + (pt ? +pt[1] : 0));
}
const scale = `scale='min(${MAXW},iw)':-2`;
const x264 = ['-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', '-an'];

function main() {
  const todo = jobs();
  if (process.argv.includes('--check')) { console.log(todo.length ? `gallery videos to finish: ${todo.map(t => `${t.slug} ${t.kind}`).join(', ')}` : 'gallery videos up to date'); process.exit(todo.length ? 1 : 0); }
  const ff = ffmpegPath();
  for (const t of todo) {
    const src = abs(t.src);
    if (t.kind === 'poster') {
      const at = frameTime(ff, src);
      execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', at.toFixed(2), '-i', src, '-frames:v', '1', '-vf', scale, '-c:v', 'libwebp', '-quality', '82', abs(t.poster)]);
      console.log(`${t.slug}: poster ${path.basename(t.poster)} (frame at ${at.toFixed(2)} s)`);
    } else if (t.kind === 'mp4') {
      execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', scale, ...x264, abs(t.mp4)]);
      console.log(`${t.slug}: mp4 from webm ${path.basename(t.mp4)} ${mb(abs(t.mp4))} MB`);
      t.kind = 'link';
    } else if (t.kind === 'slim') {
      const tmp = src + '.tmp.mp4', before = mb(src);
      execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', scale, ...x264, tmp]);
      fs.renameSync(tmp, src);
      console.log(`${t.slug}: slimmed ${path.basename(t.src)} ${before} -> ${mb(src)} MB`);
      slimmed.add(path.basename(t.src)); fs.writeFileSync(LEDGER, [...slimmed].sort().join(String.fromCharCode(10)) + String.fromCharCode(10));
    }
    if (t.kind === 'link') {   // write the new mp4 into the project file so the admin shows it too
      const j = JSON.parse(fs.readFileSync(t.file, 'utf8'));
      for (const g of j.en.gallery) if (g && g.webm === t.g.webm && !g.video) g.video = t.mp4;
      fs.writeFileSync(t.file, JSON.stringify(j, null, 2) + '\n');
    }
  }
  if (!todo.length) console.log('gallery videos up to date');
}
main();
