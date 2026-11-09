// build-lottie.mjs - writes assets/loader/bitz-write.json, the Lottie (Bodymovin) animation of the Bitz logo being hand-written, the way the
// reference calligraphy video does it: several strokes write at once, the word holds, then every stroke retracts in its own writing direction.
// How: each logo shape (assets/img/logo.svg) is a white filled layer whose alpha matte is a layer of wide round-capped strokes along the
// letter's centre lines (tools/loader/strokes.mjs) animated with Trim Paths - the same build an After Effects artist would make.
// Timeline (60 fps): write 0 -> WRITE_END, hold, erase ERASE_START -> ERASE_END. The site plays write, holds until the page is ready, then erase.
// usage: node tools/loader/build-lottie.mjs
import fs from 'node:fs';
import { STROKES } from './strokes.mjs';

const FR = 60, SCALE = 2, VB = [345.87, 255.4];
const W = Math.ceil(VB[0] * SCALE), H = Math.ceil(VB[1] * SCALE);
const SPEED = 1.0;                                     // write timing multiplier (strokes.mjs times are in seconds)
const ERASE_AT = 2.0, ERASE_K = 0.72;                  // erase starts here (s) and replays the write order this much faster
const writeEnd = Math.max(...STROKES.map(s => s.t1)) * SPEED;
const eraseEnd = ERASE_AT + writeEnd * ERASE_K;
const OP = Math.round((eraseEnd + 0.1) * FR);
const f = t => Math.round(t * FR * 100) / 100;

// ---- SVG path data -> Lottie bezier shapes (absolute cubic segments; lines get zero tangents)
function svgToShapes(d) {
  const tok = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g);
  const out = []; let k = 0, cmd = '', cur = [0, 0], start = [0, 0], lastC2 = null, sp = null;
  const num = () => parseFloat(tok[k++]);
  const isNum = () => k < tok.length && !/^[a-zA-Z]$/.test(tok[k]);
  const begin = p => { sp = { v: [p], i: [[0, 0]], o: [[0, 0]], c: false }; out.push(sp); };
  const cubic = (c1, c2, p) => {
    const n = sp.v.length - 1;
    sp.o[n] = [c1[0] - sp.v[n][0], c1[1] - sp.v[n][1]];
    sp.v.push(p); sp.i.push([c2[0] - p[0], c2[1] - p[1]]); sp.o.push([0, 0]);
    cur = p; lastC2 = c2;
  };
  const line = p => { sp.v.push(p); sp.i.push([0, 0]); sp.o.push([0, 0]); cur = p; lastC2 = null; };
  while (k < tok.length) {
    if (!isNum()) cmd = tok[k++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const R = (x, y) => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    if (C === 'M') { const p = R(num(), num()); begin(p); cur = start = p; cmd = rel ? 'l' : 'L'; lastC2 = null; }
    else if (C === 'L') line(R(num(), num()));
    else if (C === 'H') { const x = num(); line([rel ? cur[0] + x : x, cur[1]]); }
    else if (C === 'V') { const y = num(); line([cur[0], rel ? cur[1] + y : y]); }
    else if (C === 'C') { const c1 = R(num(), num()), c2 = R(num(), num()), p = R(num(), num()); cubic(c1, c2, p); }
    else if (C === 'S') { const c1 = lastC2 ? [2 * cur[0] - lastC2[0], 2 * cur[1] - lastC2[1]] : cur; const c2 = R(num(), num()), p = R(num(), num()); cubic(c1, c2, p); }
    else if (C === 'Z') {
      const n = sp.v.length - 1;
      if (n > 0 && Math.hypot(sp.v[n][0] - sp.v[0][0], sp.v[n][1] - sp.v[0][1]) < 0.01) { sp.i[0] = sp.i[n]; sp.v.pop(); sp.i.pop(); sp.o.pop(); }
      sp.c = true; cur = start; lastC2 = null;
      if (isNum()) begin(cur);
    } else throw new Error('unsupported path command ' + cmd);
  }
  return out.map(s => ({ c: s.c, v: s.v.map(p => p.map(x => +(x * SCALE).toFixed(3))), i: s.i.map(p => p.map(x => +(x * SCALE).toFixed(3))), o: s.o.map(p => p.map(x => +(x * SCALE).toFixed(3))) }));
}
// ---- a smooth open path through points (Catmull-Rom tangents)
function smooth(pts) {
  const P = pts.map(p => p.map(x => x * SCALE)), n = P.length;
  const tan = j => { const a = P[Math.max(0, j - 1)], b = P[Math.min(n - 1, j + 1)]; const k = j === 0 || j === n - 1 ? 1 / 3 : 1 / 6; return [(b[0] - a[0]) * k, (b[1] - a[1]) * k]; };
  const T = P.map((_, j) => tan(j));
  return { c: false, v: P.map(p => p.map(x => +x.toFixed(3))), i: T.map(t => [+(-t[0]).toFixed(3), +(-t[1]).toFixed(3)]), o: T.map(t => [+t[0].toFixed(3), +t[1].toFixed(3)]) };
}
const S = v => ({ a: 0, k: v });
const TR = { ty: 'tr', p: S([0, 0]), a: S([0, 0]), s: S([100, 100]), r: S(0), o: S(100), sk: S(0), sa: S(0), nm: 'Transform' };
const ease = (t0, v0, t1, v1) => ({ a: 1, k: [
  { t: f(t0), s: [v0], o: { x: [0.55], y: [0] }, i: { x: [0.22], y: [1] } },   // the pen accelerates in and settles out
  { t: f(t1), s: [v1] },
] });
const layerBase = (ind, nm) => ({ ddd: 0, ind, ty: 4, nm, sr: 1, ks: { o: S(100), r: S(0), p: S([0, 0, 0]), a: S([0, 0, 0]), s: S([100, 100, 100]) }, ao: 0, ip: 0, op: OP, st: 0, bm: 0 });

const SVG = fs.readFileSync(new URL('../../assets/img/logo.svg', import.meta.url), 'utf8');
const paths = [...SVG.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
const NAMES = ['B', 'i stem', 'i dot', 't', 'z'];
const layers = []; let ind = 1;
paths.forEach((d, si) => {
  const strokes = STROKES.filter(s => s.shape === si);
  const matte = layerBase(ind++, `${NAMES[si]} - writing (matte)`); matte.td = 1;
  matte.shapes = strokes.map((s, k) => ({
    ty: 'gr', nm: `stroke ${k + 1}`, it: [
      { ty: 'sh', nm: 'path', ks: S(smooth(s.pts)) },
      { ty: 'tm', nm: 'Trim Paths', m: 1, o: S(0),
        e: ease(s.t0 * SPEED, 0, s.t1 * SPEED, 100),
        s: ease(ERASE_AT + s.t0 * SPEED * ERASE_K, 0, ERASE_AT + s.t1 * SPEED * ERASE_K, 100) },
      { ty: 'st', nm: 'brush', c: S([1, 1, 1, 1]), o: S(100), w: S(s.w * SCALE), lc: 2, lj: 2, ml: 4 },
      TR,
    ],
  }));
  const fill = layerBase(ind++, `${NAMES[si]} - letter`); fill.tt = 1;
  fill.shapes = [{ ty: 'gr', nm: NAMES[si], it: [
    ...svgToShapes(d).map((ks, k) => ({ ty: 'sh', nm: `outline ${k + 1}`, ks: S(ks) })),
    { ty: 'fl', nm: 'white', c: S([1, 1, 1, 1]), o: S(100), r: 1 },
    TR,
  ] }];
  layers.push(matte, fill);
});
const json = {
  v: '5.12.2', fr: FR, ip: 0, op: OP, w: W, h: H, nm: 'bitz - write on', ddd: 0, assets: [], layers,
  markers: [
    { tm: 0, cm: 'write', dr: f(writeEnd) },
    { tm: f(writeEnd), cm: 'hold', dr: f(ERASE_AT - writeEnd) },
    { tm: f(ERASE_AT), cm: 'erase', dr: f(eraseEnd - ERASE_AT) },
  ],
};
fs.mkdirSync(new URL('../../assets/loader/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../../assets/loader/bitz-write.json', import.meta.url), JSON.stringify(json));
console.log(`assets/loader/bitz-write.json: ${W} x ${H}, ${OP} frames at ${FR} fps; write 0-${f(writeEnd)}, erase ${f(ERASE_AT)}-${f(eraseEnd)}; ${layers.length} layers, ${(JSON.stringify(json).length / 1024).toFixed(1)} KB`);
