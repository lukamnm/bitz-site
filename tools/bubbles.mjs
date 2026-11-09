// bubbles.mjs - makes the shot bubbles' previews from the clips themselves (no hand-made bubble images needed):
//   for every group in content/shots, its FIRST clip -> assets/shots/auto/<key>.webp (a still, the most representative frame)
//                                                    + assets/shots/auto/<key>.mp4  (a 3 s silent square loop, played on hover)
// <key> is a hash of the clip's path and size, so a preview is rebuilt only when that clip changes; unused previews are removed.
// A group's "Bubble image" in the admin, when set, replaces the still (the hover loop stays).
//   node tools/bubbles.mjs           make the missing previews
//   node tools/bubbles.mjs --check   exit 1 if any preview is missing (the deploy workflow then installs ffmpeg and runs it)
// ffmpeg: $FFMPEG, else the portable one in ../../tools/node_modules/ffmpeg-static (the laptop), else "ffmpeg" on the PATH (CI).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AUTO = 'assets/shots/auto';
const SIZE = 192, LOOP = 3;

// the preview files for one clip ("/assets/video/shots/x.webm"); null when the clip file is not there
export function bubbleFor(clip) {
  if (!clip) return null;
  const relp = clip.replace(/^\//, ''), abs = path.join(SITE, relp);
  if (!fs.existsSync(abs)) return null;
  const key = crypto.createHash('md5').update(`${relp}:${fs.statSync(abs).size}`).digest('hex').slice(0, 10);
  return { key, src: abs, img: `${AUTO}/${key}.webp`, loop: `${AUTO}/${key}.mp4` };
}
export const firstClip = en => { const it = (en.items || []).find(i => i.webm || i.mp4); return it ? it.webm || it.mp4 : null; };

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const local = path.resolve(SITE, '..', 'tools', 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(local) ? local : 'ffmpeg';
}
const run = (ff, args) => spawnSync(ff, ['-hide_banner', '-nostdin', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });

function make(b, ff) {
  const info = run(ff, ['-i', b.src]).stderr;
  const m = info.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const dur = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 6;
  // the most representative frame (ffmpeg's thumbnail filter) from the middle of the clip, skipping fade-ins
  const a = dur * 0.12, w = Math.max(0.5, Math.min(dur * 0.6, 8));
  const pick = run(ff, ['-ss', a.toFixed(2), '-t', w.toFixed(2), '-i', b.src, '-an', '-vf', 'fps=6,scale=96:-2,thumbnail=48,showinfo', '-frames:v', '1', '-f', 'null', '-']).stderr;
  const pt = pick.match(/pts_time:([\d.]+)/);
  const t0 = Math.min(dur - 0.05, a + (pt ? +pt[1] : 0));
  const sq = `crop='min(iw,ih)':'min(iw,ih)',scale=${SIZE}:${SIZE}:flags=lanczos`;
  fs.mkdirSync(path.join(SITE, AUTO), { recursive: true });
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', t0.toFixed(2), '-i', b.src, '-frames:v', '1', '-vf', sq, '-c:v', 'libwebp', '-quality', '82', path.join(SITE, b.img)]);
  const len = Math.min(LOOP, dur), s = Math.max(0, Math.min(t0 - 0.4, dur - len));
  execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', s.toFixed(2), '-t', len.toFixed(2), '-i', b.src, '-an', '-vf', `${sq},fps=30`,
    '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'slow', '-movflags', '+faststart', path.join(SITE, b.loop)]);
  return t0;
}

function main() {
  const dir = path.join(SITE, 'content/shots');
  const wanted = [];
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')) : []) {
    const { en = {} } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const b = bubbleFor(firstClip(en)); if (b) wanted.push({ group: f, ...b });
  }
  const missing = wanted.filter(b => !fs.existsSync(path.join(SITE, b.img)) || !fs.existsSync(path.join(SITE, b.loop)));
  if (process.argv.includes('--check')) { console.log(missing.length ? `bubble previews missing for: ${missing.map(b => b.group).join(', ')}` : 'bubble previews up to date'); process.exit(missing.length ? 1 : 0); }
  const ff = ffmpegPath();
  for (const b of missing) { const t = make(b, ff); const kb = f => Math.round(fs.statSync(path.join(SITE, f)).size / 1024); console.log(`${b.group}: frame at ${t.toFixed(2)} s, still ${kb(b.img)} KB, loop ${kb(b.loop)} KB`); }
  // remove previews no group uses any more
  const keep = new Set(wanted.flatMap(b => [path.basename(b.img), path.basename(b.loop)]));
  const autoDir = path.join(SITE, AUTO);
  for (const f of fs.existsSync(autoDir) ? fs.readdirSync(autoDir) : []) if (!keep.has(f)) { fs.rmSync(path.join(autoDir, f)); console.log(`removed unused ${f}`); }
  if (!missing.length) console.log('bubble previews up to date');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
