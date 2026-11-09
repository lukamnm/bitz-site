import * as THREE from 'three';

const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.search).has('rm'); // ?rm=1 = instant (dev + a11y)
const MQ = matchMedia('(max-width: 767px)');

const data = await (await fetch('data/projects.json')).json();
const overlays = await fetch('data/profile.json').then(r => r.json()).catch(() => null);   // Profile / Contact hole content (both languages)
try { await Promise.all([document.fonts.load('500 40px Moncero'), document.fonts.load('400 20px Moncero')]); } catch {}   // labels are baked into textures
let mode = 'featured';
const items = () => (mode === 'featured' ? data.filter(p => p.featured) : data);
// ---------------------------------------------------------------- language: EN / GE (Georgian texts come from the old /ge/ site, per project under i18n.ge)
let lang = 'en'; try { lang = localStorage.getItem('lang') === 'ge' ? 'ge' : 'en'; } catch {}
const UI = { en: { profile: 'Profile', featured: 'Featured', full: 'Full', contact: 'Contact', lang: 'GE' },
             ge: { profile: 'პროფილი', featured: 'რჩეული', full: 'სრული', contact: 'კონტაქტი', lang: 'EN' } };
const T = p => {                                     // the project's texts in the current language, falling back to English field by field
  const g = lang === 'ge' ? p.i18n?.ge : null;
  return { title: g?.title || p.title, blurb: g?.blurb || p.blurb, sections: (g?.sections && g.sections.length) ? g.sections : p.sections };
};
function applyLang() {
  document.documentElement.lang = lang === 'ge' ? 'ka' : 'en';
  for (const el of document.querySelectorAll('[data-ui]')) el.textContent = (hole.open && hole.what === el.dataset.ui) ? UI[lang].close : UI[lang][el.dataset.ui];
  if (hole.open) fillDisc(hole.what);
  const b = document.getElementById('langBtn'); b.textContent = UI[lang].lang; b.setAttribute('lang', lang === 'ge' ? 'en' : 'ka');
}

// ---------------------------------------------------------------- constants lifted from the reference's shader + config
const PI = Math.PI;
const SHEET = { BANK: -0.16, DIAG: 0.03, REAR_Y: 0.035, REAR_Z: 0.07, VTWIST: 0.5, SHIFT: -0.2, TAIL: 1.0, DEPTH: 0.16, DEPTH_V: 0.5, SPAN: 1.15, DOOR: -0.12, DENT: 0.1, VEL_NORM: 2800 };   // velocity terms halved after "too much distortion when scrolling, chaotic"   // depth eased from 0.2: the centre-left bulged too far toward the viewer   // SPAN and the velocity response fitted to the reference's runtime trace
const FLOOR = { drop: 0.06, run: 6, wide: 4, cell: 0.23, cellX: 0.23, grid: 0.012, lip: 0.2, refl: 0.1, reflGap: 0.07, reflSpread: 0.35, reflLight: 0.6 };   // measured against the reference at 1914x882: line peak ~20 sRGB (ours was ~43), cells ~1.1x wider, almost no reflection
const CARD = { wvh: 0.76, hvh: 0.435, maxvw: 0.46, gapPx: 12 };   // measured live at 1918x880: the reference card is 690 x 442 px on screen = its DOM box (0.76vh x 0.435vh); the earlier "1.2x taller" reading was wrong
const FOV = 50, CAMZ = 2.68 / Math.tan((FOV / 2) * Math.PI / 180);   // lens matched to the reference (fov ~50 derived from its frustum numbers)

// ---------------------------------------------------------------- state
const S = {
  s: 0, sT: 0, vel: 0, V: 0, vk: 0, vd: 0,   // reel scroll (world units), target, velocity; V = speed value 0..1 (vk: wheel impulses, vd: drag)
  Wh: 1, Hh: 1, W: 1, H: 1, pitch: 1, L: 1, D: 0, N: 0, floorY: -1,
  open: null, hover: -1, drag: null, moved: 0, dim: 0, mobile: MQ.matches,
};
const cards = []; // { i, x, mesh, tag, p, bb }
let openCard = null, lenis = null, io = null;
const held = new Set();                      // cards driven by a timeline (the open one and the two side sheets), not by the strip
let sides = {};
const SIDE_SCALE = 0.81, SIDE_DIM = 0.55;    // measured: side sheets are ~81% of the panel, washed white, mid grey against black
window.__S = S; window.__cards = cards;
let renderer, scene, camera, grid, reflRT, reflCam;
const V3 = new THREE.Vector3();
window.__errs = []; addEventListener('error', e => __errs.push(String(e.message)));
{ const ce = console.error.bind(console); console.error = (...a) => { __errs.push(a.map(String).join(' ').slice(0, 300)); ce(...a); }; }

// ---------------------------------------------------------------- post pass: cursor trail that liquid-warps and shades the scene (ported from the reference)
const TRAIL = { size: 256, diss: 4, diffuse: 40, rad: 0.04, warp: -0.045, shade: -1.2, edge: [0.22, 0.5], move0: 0.025, moveN: 0.08, follow: 7, fade: 4 };   // the reference's RUNTIME values (syncBall: $0=4 for decay and fade, bB=.04, SB=-.045, MB=-1.2, TB/EB .22/.5); the field decays fast so the bump stays compact under the pointer and reads as a lit lens, not a smear
let sceneRT, trailRT = [], trailSide = 0, trailMat, trailScene, postMat, postScene, postCam;
const ball = { tx: 0, ty: 0, sx: 0, sy: 0, e: 0, seen: false };
const hole = { p: 0, s: -0.1, open: false, what: null };   // Profile / Contact overlay state (reference: p 0..1, squash eases -0.1 -> 0 as it opens)
const disc = document.getElementById('disc');
const QUAD_VERT = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const TRAIL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D u_prev; uniform vec2 u_texel, u_pos; uniform float u_decay, u_diff, u_amp, u_rad, u_aspect;
varying vec2 vUv;
void main(){
  float c = texture2D(u_prev, vUv).r;
  float n = texture2D(u_prev, vUv + vec2(u_texel.x, 0.0)).r + texture2D(u_prev, vUv - vec2(u_texel.x, 0.0)).r
          + texture2D(u_prev, vUv + vec2(0.0, u_texel.y)).r + texture2D(u_prev, vUv - vec2(0.0, u_texel.y)).r;
  float h = mix(c, n * 0.25, u_diff) * u_decay;
  vec2 d = vUv - u_pos; vec2 q = vec2(d.x, d.y / u_aspect);
  h += u_amp * exp(-dot(q, q) / (u_rad * u_rad));
  gl_FragColor = vec4(min(h, 1.5), 0.0, 0.0, 1.0);
}`;
const POST_FRAG = /* glsl */`
precision highp float;
uniform sampler2D u_scene, u_trail; uniform vec2 u_trailTexel, u_ballEdge, u_aspect; uniform float u_ballA, u_ballWarp, u_ballShade;
uniform float u_hp, u_hr, u_hs, u_time; uniform vec2 u_hc;   // the hole (Profile / Contact overlay): progress, radius as a share of width, squash, centre in uv
varying vec2 vUv;
// the hole, modelled on the reference: a disc that is black inside, and a lens around its rim that drags the page toward the horizon,
// splits the colour channels slightly and slowly rotates ("frame dragging"), with soft lobes while it opens and a faint breath at rest
const float H_LENS = 1.5, H_REACH = 0.16, H_ORBIT = 0.3, H_WAVE = 0.05, H_ABERR = 0.004, H_BREATH = 0.015;
vec2 hRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec4 hGrab(vec2 dir, float rad) {
  vec2 sq = vec2(1.0 + u_hs, 1.0 - u_hs);
  vec2 uv = (dir * rad * u_aspect.x) / (sq * u_aspect) + u_hc;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
  return texture2D(u_scene, uv);
}
float hPull(float t, float e, float fall) { return fall * (e * e) / max(t, 0.001); }
void main(){
  vec4 page = texture2D(u_scene, vUv);
  if (u_hp > 0.001) {
    vec2 sq = vec2(1.0 + u_hs, 1.0 - u_hs);
    vec2 q = (vUv - u_hc) * u_aspect * sq;
    float t = length(q) / u_aspect.x;
    vec2 dir = length(q) > 0.00001 ? normalize(q) : vec2(1.0, 0.0);
    float ang = atan(q.y, q.x);
    float n = (sin(ang * 3.0 + u_time * 0.7) * 0.6 + sin(ang * 5.0 - u_time * 0.45) * 0.4) * H_WAVE * sin(3.14159265 * clamp(u_hp, 0.0, 1.0));
    float r = u_hp * u_hr * (1.0 + H_BREATH * sin(u_time * 1.6)) + n;
    float e = r * H_LENS;
    float fall = 1.0 - smoothstep(r, r + H_REACH, t);
    float draw = hPull(t, e, fall);
    vec2 sdir = hRot(dir, draw * H_ORBIT * min(u_time, 15.0));
    float split = e * H_ABERR;
    vec3 lensed = vec3(hGrab(sdir, t - hPull(t, e + split, fall)).r, hGrab(sdir, t - draw).g, hGrab(sdir, t - hPull(t, e - split, fall)).b);
    float inside = 1.0 - smoothstep(r - 0.0015, r + 0.0015, t);
    page = vec4(mix(lensed, vec3(0.0), inside), 1.0);
  }
  if (u_ballA > 0.001) {
    vec2 e = u_trailTexel * 2.0;                                // slightly wider slope taps than the reference's 1.5: the same bump, a softer-edged ring
    vec2 g = vec2(texture2D(u_trail, vUv + vec2(e.x, 0.0)).r - texture2D(u_trail, vUv - vec2(e.x, 0.0)).r,
                  texture2D(u_trail, vUv + vec2(0.0, e.y)).r - texture2D(u_trail, vUv - vec2(0.0, e.y)).r);
    vec2 pw = vec2(vUv.x - 0.5, (vUv.y - 0.5) / u_aspect.x);
    float edge = 1.0 - smoothstep(u_ballEdge.x, u_ballEdge.y, length(pw));
    vec2 off = g * u_ballWarp * u_ballA * edge;
    vec2 buv = clamp(vUv + off, 0.0, 1.0);
    float m = smoothstep(0.0, 0.002, length(off));
    vec3 warped = texture2D(u_scene, buv).rgb;
    float shade = dot(-g, normalize(vec2(-0.3, 1.0))) * u_ballShade * u_ballA * edge;
    float lum = dot(warped, vec3(0.2126, 0.7152, 0.0722));
    float head = 1.0 - smoothstep(0.7, 0.95, lum);
    // ceiling 0.6 with a soft knee (the reference hard-clamps at 0.5): full strength where the lighting lives (|shade| < 0.4), but the
    // saturated crescents that read as a crisp circle on our dark cards round off instead of going flat
    warped *= 1.0 + 0.6 * tanh(shade / 0.6) * head;
    page = mix(page, vec4(warped, 1.0), m);
  }
  gl_FragColor = page;
  #include <colorspace_fragment>
}`;
function initPost() {
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  sceneRT = new THREE.WebGLRenderTarget(db.x, db.y, { depthBuffer: true, samples: 4 });   // MSAA: offscreen targets get no AA otherwise (stepped card edges)
  const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false };
  trailRT = [new THREE.WebGLRenderTarget(TRAIL.size, TRAIL.size, opts), new THREE.WebGLRenderTarget(TRAIL.size, TRAIL.size, opts)];
  postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  trailMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: TRAIL_FRAG, depthTest: false, depthWrite: false, uniforms: {
    u_prev: { value: null }, u_texel: { value: new THREE.Vector2(1 / TRAIL.size, 1 / TRAIL.size) }, u_decay: { value: 1 }, u_diff: { value: 0 },
    u_pos: { value: new THREE.Vector2(0.5, 0.5) }, u_amp: { value: 0 }, u_rad: { value: TRAIL.rad }, u_aspect: { value: 1 } } });
  trailScene = new THREE.Scene(); trailScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), trailMat));
  postMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false, uniforms: {
    u_scene: { value: sceneRT.texture }, u_trail: { value: trailRT[0].texture }, u_trailTexel: { value: new THREE.Vector2(1 / TRAIL.size, 1 / TRAIL.size) },
    u_ballEdge: { value: new THREE.Vector2(TRAIL.edge[0], TRAIL.edge[1]) }, u_aspect: { value: new THREE.Vector2(1, 1) },
    u_ballA: { value: 0 }, u_ballWarp: { value: TRAIL.warp }, u_ballShade: { value: TRAIL.shade },
    u_hp: { value: 0 }, u_hr: { value: 0.11 }, u_hs: { value: -0.1 }, u_hc: { value: new THREE.Vector2(0.5, 0.5) }, u_time: { value: 0 } } });
  postScene = new THREE.Scene(); postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
  addEventListener('pointermove', e => { ball.tx = e.clientX; ball.ty = e.clientY; if (!ball.seen) { ball.sx = e.clientX; ball.sy = e.clientY; ball.seen = true; } });
}
function stepPost(dt) {
  const w = innerWidth, h = innerHeight;
  ball.e *= Math.exp(-TRAIL.fade * dt);
  let amp = 0;
  if (ball.seen && !RM) {
    const k = 1 - Math.exp(-TRAIL.follow * dt);
    ball.sx += (ball.tx - ball.sx) * k; ball.sy += (ball.ty - ball.sy) * k;
    const d = Math.hypot(ball.tx - ball.sx, ball.ty - ball.sy) / w;
    const p = Math.tanh(Math.max(0, d - TRAIL.move0) / TRAIL.moveN);
    amp = p * p;
  }
  ball.e = Math.max(ball.e, amp);
  const u = trailMat.uniforms;
  u.u_prev.value = trailRT[trailSide].texture; u.u_pos.value.set(ball.tx / w, 1 - ball.ty / h);
  u.u_amp.value = amp; u.u_decay.value = Math.exp(-TRAIL.diss * dt); u.u_diff.value = 1 - Math.exp(-TRAIL.diffuse * dt); u.u_aspect.value = w / h;   // dt-shaped like the reference (min(1, k*dt) saturated on slow frames and flattened the field)
  renderer.setRenderTarget(trailRT[1 - trailSide]); renderer.render(trailScene, postCam); renderer.setRenderTarget(null);
  trailSide = 1 - trailSide;
  const p = postMat.uniforms;
  // reference: u_ballA is PRESENCE (1 while the field holds any ink), not the envelope - the field itself does the fading, so the bump lingers and relaxes smoothly
  p.u_trail.value = trailRT[trailSide].texture; p.u_ballA.value = ball.seen && ball.e > 0.004 ? 1 - hole.p : 0; p.u_aspect.value.set(w / h, 1);
  // the hole follows its disc element (centre and radius), like the reference binding the hole to the overlay's circle
  p.u_hp.value = hole.p; p.u_hs.value = hole.s; p.u_time.value += dt;
  if (hole.p > 0.001) { const r = disc.getBoundingClientRect(); p.u_hc.value.set((r.left + r.width / 2) / w, 1 - (r.top + r.height / 2) / h); p.u_hr.value = r.width / 2 / w; }
}

// ---------------------------------------------------------------- preloader
let loaded = 0, total = 0, preDone = false;
function progress() {
  $('#pre b').textContent = total ? Math.round((loaded / total) * 100) : 0;
  if (loaded >= total && !preDone) dismissPre();
}
function dismissPre() {
  if (preDone) return; preDone = true;
  if (RM) $('#pre').style.display = 'none';
  else gsap.to('#pre', { opacity: 0, duration: 0.6, delay: 0.15, ease: 'power2.out', onComplete: () => ($('#pre').style.display = 'none') });
  if (!S.mobile) intro();
}
setTimeout(dismissPre, 4000);

// ---------------------------------------------------------------- sheet math (JS mirror of the shader, for labels and picking)
const shape = q => ((1 - q * q) * 0 + Math.sin(PI * q)) * Math.exp(-SHEET.TAIL * q * q);           // C = 1 (desktop): the near-to-far S
const slope = q => { const g = Math.exp(-SHEET.TAIL * q * q); return (PI * Math.cos(PI * q) - 2 * SHEET.TAIL * q * Math.sin(PI * q)) * g; };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function sheetPoint(wx, ly, out) {
  const q = (wx / S.Wh) * SHEET.SPAN + SHEET.SHIFT, qe = wx / S.Wh;
  let a = SHEET.BANK * slope(q) / PI;
  a += SHEET.VTWIST * S.V * sstep(0.3, 0.9, Math.abs(qe)) * Math.sign(qe);
  let y = ly * Math.cos(a), z = ly * Math.sin(a);
  const qc = clamp(qe, -1, 1);
  z += -S.D * shape(q) + SHEET.DOOR * S.Wh * qc * (1.5 - 0.5 * qc * qc);   // same leanRamp as the shaders
  y += SHEET.DIAG * wx;
  const m = 1 - sstep(-1, 0.3, qe);
  y += SHEET.REAR_Y * S.Wh * S.V * m; z += SHEET.REAR_Z * S.Wh * S.V * m;
  return out.set(wx, y, z);
}

// ---------------------------------------------------------------- card shader: strip wave, bank, velocity twist + rear-up, hover dome, depth shade, rounded corners, white crossfade
const VERT = /* glsl */`
uniform float uWh, uD, uT, uV, uP, uLeanA, uHover, uDentH, uDiag, uBulgeA, uBulgeH;
uniform vec2 uAspect;
varying vec2 vUv; varying float vD; varying float vWx; varying float vBank; varying vec3 vP;
const float PI = 3.14159265;
const float BANK = -0.16, VTWIST = 0.5, REAR_Y = 0.035, REAR_Z = 0.07, SHIFT = -0.2, TAIL = 1.0;
float shape(float q){ return sin(PI * q) * exp(-TAIL * q * q); }
float slope(float q){ float g = exp(-TAIL * q * q); return (PI * cos(PI * q) - 2.0 * TAIL * q * sin(PI * q)) * g; }
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);        // the strip lies flat at z = 0, centred on y = 0
  float P = uP;                                       // sheet strength: 1 on the strip, 0 when the card is the panel
  float wx = w.x, qe = wx / uWh;
  float q = qe * uT + SHIFT;
  float a = BANK * slope(q) / PI * P;                                            // resting bank
  a += VTWIST * uV * smoothstep(0.3, 0.9, abs(qe)) * sign(qe) * P;              // velocity edge twist, outer cards only
  float sn = sin(a), cs = cos(a);
  w.yz = vec2(w.y * cs - w.z * sn, w.y * sn + w.z * cs);                        // wind about the strip centreline
  float z = -uD * shape(q);
  float qc = clamp(qe, -1.0, 1.0);
  w.z += z * P + uLeanA * qc * (1.5 - 0.5 * qc * qc) * P;                       // depth wave + door lean (reference leanRamp, shared with the floor)
  w.y += uDiag * wx * P;
  float m = 1.0 - smoothstep(-1.0, 0.3, qe);                                     // rear-up: left side lifts and comes nearer with speed
  w.y += REAR_Y * uWh * uV * m * P;
  w.z += REAR_Z * uWh * uV * m * P;
  vec2 qq = uv * 2.0 - 1.0;
  float dome = (1.0 - qq.x * qq.x) * (1.0 - qq.y * qq.y);
  w.z -= uHover * uDentH * dome;                                                 // hover: the middle bows back
  if (uBulgeH > 0.001) {                                                         // open panel: scroll speed bows the sheet toward / away from the viewer
    float tb = clamp(w.y / uBulgeH, -1.0, 1.0);                                  // (reference bulge(): zero at the frustum top and bottom, full at mid-height)
    w.z += uBulgeA * (1.0 - tb * tb);
  }
  vD = clamp((uD - z) / max(2.0 * uD, 0.001), 0.0, 1.0) * P;   // depth shade from the wave only (the dome banded into rings on dark cards)
  vWx = wx; vBank = a; vP = w.xyz;                                             // the fragment shader rebuilds the normal per pixel (no banding)
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = /* glsl */`
precision highp float;
#define DITHERING
#include <common>
#include <dithering_pars_fragment>
uniform sampler2D uMap, uVid; uniform vec2 uRepeat, uOffset, uAspect, uClipY, uVidRepeat, uVidOffset; uniform float uHasVid;
uniform float uWhite, uDim, uRadius, uHasMap, uShade, uHover, uWh, uD, uT, uP, uAlpha, uArrow;
uniform vec4 uPillBox[2];    // hovered chips (two slots so one can fade out while the next fades in): centre xy, half-size zw, plane units
uniform vec4 uPillDisc[2];   // disc centre xy (follows the pointer), z: radius that covers the chip, w: the chip's corner radius
uniform vec2 uPillA[2];      // x: hover 0..1, y: 1 on text chips (lens + channel split), 0 on the round link disc
varying vec2 vUv; varying float vD; varying float vWx; varying float vBank; varying vec3 vP;
const float SHIFT = -0.2, TAIL = 1.0;
const float PILL_LENS = 0.08, PILL_SPLIT = 3.0;   // reference: label lens 0.33 x 1.6 (ours is gentler: the chip shape itself does not swell), channels apart at the lens centre
// chip hover, as the reference's pills: a disc grows from the pointer and inverts the chip (light fill -> near black, ink -> white),
// the label is magnified under the pointer's lens and its colour channels come apart along x, fading to nothing at the lens rim
vec4 pillSample(vec2 uv, vec2 px) {
  vec4 t = texture2D(uMap, uv * uRepeat + uOffset);
  float fwu = fwidth(vUv.x), aa = max(fwidth(px.x), 1e-5);   // derivatives BEFORE any divergent branch (undefined after one, zero on D3D)
  for (int i = 0; i < 2; i++) {
    float A = uPillA[i].x; if (A < 0.0001) continue;
    vec4 b = uPillBox[i]; float cr = uPillDisc[i].w;
    vec2 q = abs(px - b.xy) - (b.zw - cr);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - cr;
    if (sd > 0.0) continue;
    vec2 rel = px - uPillDisc[i].xy;
    float R = max(b.z, b.w);
    float Rd = max(uPillDisc[i].z, 1e-4);
    float k = max(1.0 - dot(rel, rel) / (R * R), 0.0);
    float kd = max(1.0 - dot(rel, rel) / (Rd * Rd), 0.0);
    float lens = uPillA[i].y * A;
    vec2 luv = uv - (rel / uAspect) * PILL_LENS * lens * k * k;                 // magnify: pull the sample toward the lens centre
    float split = kd * PILL_SPLIT * lens * fwu;
    vec4 c0 = texture2D(uMap, luv * uRepeat + uOffset);
    float r = texture2D(uMap, (luv + vec2(split, 0.0)) * uRepeat + uOffset).r;
    float bl = texture2D(uMap, (luv - vec2(split, 0.0)) * uRepeat + uOffset).b;
    vec3 c = vec3(r, c0.g, bl);
    float m = 1.0 - smoothstep(-aa, aa, length(rel) - mix(-0.04 * Rd, Rd, A));   // the disc: from nothing to past the far corner
    vec3 inv = clamp(vec3(0.8926) - c, 0.0, 1.0);                                // #f2f2f2 <-> #111 and #0a0a0a <-> white, in linear light
    t = vec4(mix(c, inv, m), c0.a);
  }
  return t;
}
const vec3 LIGHT_DIR = normalize(vec3(-0.4, 0.5, 1.0));
const float LIGHT_GLOSS = 48.0, LIGHT_SPEC = 0.09, LIGHT_DIFF = 0.06;   // spec scaled from the reference's sRGB-space 0.35 to linear light; diffuse halved from 0.12 (Luka: keep the images' own colours)
float slopeF(float q){ float g = exp(-TAIL * q * q); return (PI * cos(PI * q) - 2.0 * TAIL * q * sin(PI * q)) * g; }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float arrowMask(vec2 p, float r){           // right arrow glyph, p relative to the disc centre, in disc radii
  float d = sdSeg(p, vec2(-0.38, 0.0), vec2(0.38, 0.0));
  d = min(d, sdSeg(p, vec2(0.38, 0.0), vec2(0.05, 0.33)));
  d = min(d, sdSeg(p, vec2(0.38, 0.0), vec2(0.05, -0.33)));
  return 1.0 - smoothstep(0.05, 0.1, d);
}
void main(){
  if (vP.y < uClipY.x || vP.y > uClipY.y) discard;         // panel planes are clipped to the scroll area
  vec2 q = abs(vUv - 0.5) * uAspect - (uAspect * 0.5 - vec2(uRadius));
  float ed = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;   // signed distance to the rounded edge (world units)
  float cov = 1.0 - smoothstep(-max(fwidth(ed), 1e-5), 0.0, ed);         // one-pixel soft edge (alpha-to-coverage on opaque cards, blending on panel planes)
  if (cov <= 0.0) discard;
  vec3 col = vec3(0.09);
  float ta = 1.0;                                             // texture alpha: text planes are transparent canvases
  if (uHasMap > 0.5) { vec4 t = pillSample(vUv, vUv * uAspect); col = t.rgb; ta = t.a; }
  if (uHasVid > 0.5) {                                        // video under the baked label overlay
    vec3 vc = texture2D(uVid, vUv * uVidRepeat + uVidOffset).rgb;
    col = mix(vc, col, ta); ta = 1.0;
  }
  // reference shading: far side darkens toward near-black, then the sheet is lit from the upper left (static sheen)
  col = mix(col, vec3(0.005), uShade * 0.8 * vD * vD);      // 0.059 sRGB -> linear; squared (reference spread 1): the near cards keep their true colours, the far side still hazes
  // static sheen: normal from the wave slope only (per pixel, no hover dome so the highlight never moves), rolled by the bank
  float qs = (vWx / uWh) * uT + SHIFT;
  float dzdx = -uD * slopeF(qs) * uT / uWh * uP;
  vec3 n = normalize(vec3(-dzdx, 0.0, 1.0));
  float sn = sin(vBank), cs = cos(vBank);
  n.yz = vec2(n.y * cs - n.z * sn, n.y * sn + n.z * cs);
  vec3 v = normalize(cameraPosition - vP);
  float dl = dot(n, LIGHT_DIR) * 0.5 + 0.5;
  col *= 1.0 - LIGHT_DIFF * uShade * (1.0 - dl);
  vec3 h = normalize(LIGHT_DIR + v);
  col += pow(max(dot(n, h), 0.0), LIGHT_GLOSS) * LIGHT_SPEC * uShade;
  // arrow disc, bottom-right, drawn here so the mark can slide out / in on hover (reference u_markOut / u_markIn)
  vec2 px = vUv * uAspect;                                    // card-space, world units
  float k = smoothstep(0.0, 1.0, uHover);
  float m = 0.045 * uAspect.x, r0 = 0.0215 * uAspect.x, r = r0 * (1.0 + 0.3 * k);   // the disc grows 30% on hover
  vec2 c = vec2(uAspect.x - m - r0, m + 0.75 * r0);
  float dd = length(px - c) / r;
  if (uArrow > 0.5 && dd < 1.0) {
    vec3 disc = mix(vec3(0.0056), vec3(1.0), k);              // #111 flips to white on hover
    vec3 ink = mix(vec3(1.0), vec3(0.0056), k);               // and the mark to black
    vec2 lp = (px - c) / r;
    float kk = k * k * (3.0 - 2.0 * k);
    float a1 = arrowMask(lp - vec2(2.0, 1.2) * kk, r);          // current mark flies out along its own direction (up-right)
    float a2 = arrowMask(lp + vec2(2.0, 1.2) * (1.0 - kk), r);  // the next one arrives from bottom-left
    disc = mix(disc, ink, max(a1, a2));
    col = mix(col, disc, 1.0 - smoothstep(0.96, 1.0, dd));
  }
  col = mix(col, vec3(1.0), uWhite);
  col *= 1.0 - uDim;
  gl_FragColor = vec4(col, uAlpha * cov * ta);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}`;
function cardMaterial(transparent = false) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent, alphaToCoverage: !transparent,
    uniforms: {
      uAlpha: { value: 1 }, uClipY: { value: new THREE.Vector2(-1e3, 1e3) }, uArrow: { value: 1 },
      uMap: { value: null }, uHasMap: { value: 0 }, uRepeat: { value: new THREE.Vector2(1, 1) }, uOffset: { value: new THREE.Vector2() },
      uVid: { value: null }, uHasVid: { value: 0 }, uVidRepeat: { value: new THREE.Vector2(1, 1) }, uVidOffset: { value: new THREE.Vector2() },
      uAspect: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 0.1 },
      uWh: { value: 1 }, uD: { value: 0 }, uT: { value: SHEET.SPAN }, uV: { value: 0 }, uP: { value: 1 }, uLeanA: { value: 0 }, uDiag: { value: SHEET.DIAG },
      uHover: { value: 0 }, uDentH: { value: 0 }, uShade: { value: 1 }, uWhite: { value: 0 }, uDim: { value: 0 },
      uBulgeA: { value: 0 }, uBulgeH: { value: 0 },
      uPillBox: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uPillDisc: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uPillA: { value: [new THREE.Vector2(), new THREE.Vector2()] },
    },
  });
}

// ---------------------------------------------------------------- card textures: cover + title + category + arrow baked into one canvas,
// so the label is part of the card and bends with it (the reference draws its titles in GL on the same surface)
function bake(c) {
  const cw = 1600, ch = Math.round(cw * S.H / S.W);
  const cv = c.canvas || (c.canvas = document.createElement('canvas'));
  cv.width = cw; cv.height = ch;
  const x = cv.getContext('2d');
  x.clearRect(0, 0, cw, ch);
  if (!c.vid) { x.fillStyle = '#141414'; x.fillRect(0, 0, cw, ch); }   // video cards: the bake is only the label overlay, the shader shows the video under it
  if (c.img && !c.vid) {                                      // cover-crop
    const ia = c.img.width / c.img.height, ca = cw / ch;
    let sw = c.img.width, sh = c.img.height, sx = 0, sy = 0;
    if (ia > ca) { sw = c.img.height * ca; sx = (c.img.width - sw) / 2; } else { sh = c.img.width / ca; sy = (c.img.height - sh) / 2; }
    x.drawImage(c.img, sx, sy, sw, sh, 0, 0, cw, ch);
  }
  // no darkening gradient: the reference's title scrim is off (u_scrim 0), the image keeps its colours and the title relies on its shadow
  // label like the reference: title only, regular weight, bottom-left; a small black arrow disc bottom-right
  // reference card title: 1.2vw on screen with -0.05em tracking; the card is 0.76vh wide, so as a share of the texture: 0.012 * (vw/vh) / 0.76
  const m = 0.045 * cw, tf = Math.min(0.045, 0.012 * (innerWidth / innerHeight) / 0.76) * cw;
  x.textBaseline = 'alphabetic'; x.fillStyle = '#fff';
  x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 0.01 * cw;
  x.font = `400 ${tf}px Moncero, Inter, system-ui, sans-serif`;
  x.letterSpacing = `${-0.05 * tf}px`;
  const maxW = cw - 2 * m - 0.09 * cw;
  let title = T(c.p).title; while (x.measureText(title).width > maxW && title.length > 4) title = title.slice(0, -2).trimEnd() + '…';
  x.fillText(title, m, ch - m);
  x.shadowBlur = 0;                            // the arrow disc is drawn by the shader (it animates on hover)
  const u = c.mesh.material.uniforms;
  if (!c.tex) {
    c.tex = new THREE.CanvasTexture(cv); c.tex.colorSpace = THREE.SRGBColorSpace;
    c.tex.anisotropy = renderer.capabilities.getMaxAnisotropy(); c.tex.wrapS = c.tex.wrapT = THREE.ClampToEdgeWrapping;
    u.uMap.value = c.tex; u.uHasMap.value = 1;
  } else c.tex.needsUpdate = true;
}
function loadTex(c) {
  total++;
  const home = c.p.home || {}, src = home.img || c.p.cover;
  c.vid = !!home.video && !S.mobile;
  const img = new Image();
  img.onload = () => { c.img = img; bake(c); if (c.vid) setVideoCover(c, img); loaded++; progress(); };
  img.onerror = () => { c.img = null; bake(c); loaded++; progress(); };
  img.src = src;
}
// video cards (the live bitz.ge home page plays loops on Marsleaders and E-Space): the poster shows until the first frame is decoded
function setVideoCover(c, poster) {
  const u = c.mesh.material.uniforms;
  const pt = new THREE.Texture(poster); pt.colorSpace = THREE.SRGBColorSpace; pt.needsUpdate = true;
  u.uVid.value = pt; u.uHasVid.value = 1; c.vidW = poster.width; c.vidH = poster.height; setVidCrop(c);
  const v = document.createElement('video');
  v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
  for (const [src, type] of [[c.p.home.video, 'video/mp4'], [c.p.home.webm, 'video/webm']]) {   // the browser takes the first it can decode
    if (!src) continue;
    const s = document.createElement('source'); s.src = src; s.type = type; v.appendChild(s);
  }
  v.addEventListener('playing', () => {
    const vt = new THREE.VideoTexture(v); vt.colorSpace = THREE.SRGBColorSpace; vt.minFilter = THREE.LinearFilter;
    u.uVid.value = vt; c.vidW = v.videoWidth; c.vidH = v.videoHeight; setVidCrop(c); pt.dispose();
  }, { once: true });
  c.video = v;
  v.play().catch(() => {});
}
function setVidCrop(c) {
  if (!c.vidW) return;
  const u = c.mesh.material.uniforms, ia = c.vidW / c.vidH, ca = S.W / S.H;
  if (ia > ca) { u.uVidRepeat.value.set(ca / ia, 1); u.uVidOffset.value.set((1 - ca / ia) / 2, 0); } else { u.uVidRepeat.value.set(1, ia / ca); u.uVidOffset.value.set(0, (1 - ia / ca) / 2); }
}
let bakeT;
function rebakeAll() { clearTimeout(bakeT); bakeT = setTimeout(() => cards.forEach(c => c.img !== undefined && bake(c)), 150); }

// ---------------------------------------------------------------- floor: shader grid, the cards reflect in its lines
const FLOOR_VERT = /* glsl */`
uniform float uRun, uLeanA, uLeanW;
varying vec3 vWorld; varying float vFar;
float leanRamp(float s) { s = clamp(s, -1.0, 1.0); return s * (1.5 - 0.5 * s * s); }
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vFar = -wp.z / uRun;                                   // along the run, before the lean moves z
  wp.z += uLeanA * leanRamp(wp.x / uLeanW);              // the floor takes the strip's door lean: same ramp of world x, so both hinge as one object
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FLOOR_FRAG = /* glsl */`
precision highp float;
uniform float uCell, uCellX, uRun, uGrid, uReflA, uReflSpread, uReflLX, uDimF;   // the reference's cells are wider than deep (~1.6:1)
uniform sampler2D uRefl; uniform mat4 uReflVP;
varying vec3 vWorld; varying float vFar;
void main(){
  float fade = 1.0 - smoothstep(0.2, 0.95, vFar);            // the reference's dissolve
  vec2 g = vec2(vWorld.x / uCellX, vFar * uRun / uCell);
  vec2 gf = abs(fract(g) - 0.5);
  vec2 gw = fwidth(g) * 1.1;                                 // ~1 px lines, like the reference
  vec2 lines = vec2(1.0) - smoothstep(vec2(0.0), gw, gf);
  float line = max(lines.x, lines.y);
  vec3 col = vec3(line * uGrid * fade);
  if (uReflA > 0.001) {
    vec3 wp = vWorld;
    wp.x -= (vWorld.x - uReflLX) * uReflSpread * abs(vFar);
    vec4 rp = uReflVP * vec4(wp, 1.0);
    vec2 ruv = (rp.xy / max(rp.w, 0.0001)) * 0.5 + 0.5;
    vec2 soft = smoothstep(vec2(0.0), vec2(0.1), ruv) * (vec2(1.0) - smoothstep(vec2(0.9), vec2(1.0), ruv));
    float ok = soft.x * soft.y;
    vec3 refl = texture2D(uRefl, ruv).rgb;
    float fall = exp(-((vFar > 0.0) ? vFar * 6.0 : -vFar * 2.2));
    col += refl * line * uReflA * fall * ok * fade;
  }
  gl_FragColor = vec4(col * uDimF, 1.0);
  #include <colorspace_fragment>
}`;
function makeFloor() {
  const mat = new THREE.ShaderMaterial({ vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, depthWrite: false, depthTest: false, uniforms: {   // the floor must never occlude a card (the opening panel grows below floor level)
    uCell: { value: 1 }, uCellX: { value: 1 }, uRun: { value: 1 }, uLeanA: { value: 0 }, uLeanW: { value: 1 }, uGrid: { value: FLOOR.grid }, uReflA: { value: FLOOR.refl }, uReflSpread: { value: FLOOR.reflSpread },
    uReflLX: { value: 0 }, uDimF: { value: 1 }, uRefl: { value: null }, uReflVP: { value: new THREE.Matrix4() },
  } });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 96, 4), mat);   // subdivided across x so the lean bends it smoothly
  m.rotation.x = -Math.PI / 2; m.renderOrder = -1; m.frustumCulled = false;
  return m;
}
function renderReflection() {
  const my = S.floorY - FLOOR.reflGap * S.Hh;
  reflCam.fov = camera.fov; reflCam.aspect = camera.aspect; reflCam.updateProjectionMatrix();
  reflCam.position.set(camera.position.x, 2 * my - camera.position.y, camera.position.z);
  reflCam.lookAt(0, 2 * my, 0);
  reflCam.updateMatrixWorld();
  grid.visible = false;
  renderer.setRenderTarget(reflRT); renderer.render(scene, reflCam); renderer.setRenderTarget(null);
  grid.visible = true;
  const fu = grid.material.uniforms;
  fu.uRefl.value = reflRT.texture;
  fu.uReflVP.value.copy(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);
  fu.uReflLX.value = -S.Wh * FLOOR.reflLight;
}

// ---------------------------------------------------------------- scene
function initGL() {
  const canvas = $('#gl');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAMZ); camera.lookAt(0, 0, 0);
  grid = makeFloor(); scene.add(grid);
  reflRT = new THREE.WebGLRenderTarget(768, 432);   // NO MSAA here: two multisampled targets per frame cost 40 fps vs 105 on an AMD iGPU, and the reflection only shows in the grid lines
  reflCam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  initPost();
  buildRing();
  resize();
  addEventListener('resize', resize);
  bindInput(canvas);
  last = performance.now();
  requestAnimationFrame(frame);
}

// world-space layout from the viewport: cards are sized like the reference's (fractions of the frustum at z = 0)
function layout() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  S.Hh = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * CAMZ;
  S.Wh = S.Hh * camera.aspect;
  const pxw = (2 * S.Wh) / w;
  S.W = Math.min(CARD.wvh * h, CARD.maxvw * w) * pxw; S.H = CARD.hvh * 2 * S.Hh;
  S.pitch = S.W + CARD.gapPx * pxw;
  S.L = S.N * S.pitch;
  S.D = S.Wh * SHEET.DEPTH;
  S.floorY = -S.H / 2 - FLOOR.drop * S.Hh;
  for (const c of cards) {
    if (c === openCard) continue;
    c.mesh.scale.set(S.W, S.H, 1);
    const u = c.mesh.material.uniforms;
    u.uAspect.value.set(S.W, S.H); u.uRadius.value = 0.055 * S.H;
    u.uWh.value = S.Wh; u.uLeanA.value = S.Wh * SHEET.DOOR; u.uDentH.value = SHEET.DENT * S.H;
    if (c.vid) setVidCrop(c);
  }
  rebakeAll();
  sizeLoop();
  clearTimeout(planeT); planeT = setTimeout(() => { if (pplanes.length) buildPanelPlanes(); }, 150);   // text rasters depend on the layout
  // floor extent (reference: lip toward the camera, run x H toward the back, wide x W sideways)
  const run = FLOOR.run * S.Hh;
  const u = Math.min(CAMZ * (1 - Math.abs(S.floorY) / S.Hh) + S.Hh * FLOOR.lip, CAMZ * 0.8);
  grid.scale.set(S.Wh * 2 * FLOOR.wide, u + run, 1);
  grid.position.set(0, S.floorY, (u - run) / 2);
  grid.material.uniforms.uRun.value = run;
  grid.material.uniforms.uCell.value = FLOOR.cell * S.Hh;
  grid.material.uniforms.uCellX.value = FLOOR.cellX * S.Hh;
  grid.material.uniforms.uLeanA.value = S.Wh * SHEET.DOOR;
  grid.material.uniforms.uLeanW.value = S.Wh;
}

function buildRing() {
  for (const c of cards) { scene.remove(c.mesh); c.mesh.geometry.dispose(); c.tex?.dispose(); c.mesh.material.dispose(); }
  cards.length = 0;
  const L = items(); S.N = L.length;
  const geo = new THREE.PlaneGeometry(1, 1, 48, 12);
  L.forEach((p, i) => {
    const mesh = new THREE.Mesh(geo, cardMaterial());
    mesh.userData.i = i; mesh.frustumCulled = false;
    scene.add(mesh);
    const c = { i, x: 0, mesh, p, bb: null };
    cards.push(c);
    loadTex(c);
  });
  S.s = S.sT = 0; S.vel = 0;
  layout();
  placeCards();
}

function intro() {
  if (RM) return;
  S.s = 1.2 * S.pitch; S.sT = 0; S.vel = 0;        // the strip slides in through the spring
  gsap.from(camera.position, { z: CAMZ + 2.5, duration: 1.8, ease: 'expo.out' });
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  if (sceneRT) { const db = renderer.getDrawingBufferSize(new THREE.Vector2()); sceneRT.setSize(db.x, db.y); }
  layout();
}

function placeCards() {
  for (const c of cards) {
    let x = c.i * S.pitch - S.s;
    x = ((x + S.L / 2) % S.L + S.L) % S.L - S.L / 2;    // wrap: the strip loops forever
    c.x = x;
    const u = c.mesh.material.uniforms;
    u.uV.value = S.V; u.uD.value = S.D * (1 + SHEET.DEPTH_V * S.V);
    if (held.has(c)) continue;
    c.mesh.position.set(x, 0, 0);
    c.mesh.visible = S.dim < 0.999 && Math.abs(x) < S.Wh + S.W;   // fade out with the dim, not a pop
    u.uDim.value = S.dim;
  }
}

let last = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
  if (RM) { S.s = S.sT; S.vel = 0; }
  else {
    // the reference's reel is an exponential ease-out (Lenis-style lerp): 26% / 49% / 59% of a card at 155 / 300 / 450 ms = tau 0.5 s;
    // while dragging it follows the hand tightly
    const tau = S.drag ? 0.12 : 0.5;
    const prev = S.s;
    const vmax = (S.drag ? 30 : 2.2) * S.pitch;            // speed ceiling: at most ~2 cards per second from the wheel, like the reference
    const step = (S.sT - S.s) * (1 - Math.exp(-dt / tau));
    S.s += clamp(step, -vmax * dt, vmax * dt);
    S.vel = (S.s - prev) / dt;
  }
  // speed value, modelled on the reference's trace: a wheel notch is a small impulse (0.15) that decays in ~150 ms and
  // stacks during a burst (5 fast notches -> ~0.5); a drag maps the pointer speed (hard drag -> ~0.6)
  S.vk *= Math.exp(-dt / 0.2);
  if (!S.drag) S.vd *= Math.exp(-dt / 0.2);
  S.V = RM ? 0 : Math.max(S.vk, S.vd);
  placeCards();
  syncPanelPlanes();

  const w = innerWidth, h = innerHeight;
  for (const c of cards) {
    if (!c.mesh.visible || held.has(c)) { c.bb = null; continue; }
    // project the card's corners through the same sheet math -> picking box
    const x0 = c.x - S.W / 2, x1 = c.x + S.W / 2, y0 = -S.H / 2, y1 = S.H / 2;
    const P = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => { sheetPoint(x, y, V3).project(camera); return [(V3.x * 0.5 + 0.5) * w, (-V3.y * 0.5 + 0.5) * h]; });
    c.bb = { l: Math.min(P[0][0], P[3][0]), r: Math.max(P[1][0], P[2][0]), t: Math.min(P[2][1], P[3][1]), b: Math.max(P[0][1], P[1][1]) };
  }
  if (DBG.refl) renderReflection();
  if (DBG.post) {
    stepPost(dt);
    renderer.setRenderTarget(sceneRT); renderer.render(scene, camera); renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  } else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
const DBG = window.__dbg = { refl: true, post: true };     // ablation switches for the lab's frame-rate probes
window.__setSamples = n => {                                // rebuild the offscreen targets with n MSAA samples (0 = off)
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  sceneRT.dispose(); sceneRT = new THREE.WebGLRenderTarget(db.x, db.y, { depthBuffer: true, samples: n }); postMat.uniforms.u_scene.value = sceneRT.texture;
};

// ---------------------------------------------------------------- input
let snapT;
const pxToWorld = () => (2 * S.Wh) / innerWidth;
function snap(fling = 0) { S.sT = Math.round((S.sT + fling) / S.pitch) * S.pitch; }
function snapLater() { clearTimeout(snapT); snapT = setTimeout(() => snap(), 420); }   // free scroll, soft settle onto a card afterwards
function frontIndex() { let best = -1, bd = 1e9; for (const c of cards) { const d = Math.abs(c.x); if (d < bd) { bd = d; best = c.i; } } return best; }
function pick(e) {
  let best = -1, bd = 1e9;
  for (const c of cards) {
    if (!c.bb) continue;
    if (e.clientX >= c.bb.l && e.clientX <= c.bb.r && e.clientY >= c.bb.t && e.clientY <= c.bb.b) { const d = Math.abs(c.x); if (d < bd) { bd = d; best = c.i; } }
  }
  return best;
}
function setHover(i, canvas) {
  if (i === S.hover) return;
  const dur = RM ? 0 : 0.4;                   // measured on the reference: 0 -> 1 in ~250 ms, eased out
  if (S.hover >= 0 && cards[S.hover] && !held.has(cards[S.hover])) gsap.to(cards[S.hover].mesh.material.uniforms.uHover, { value: 0, duration: dur * 1.5, ease: 'power2.out' });
  S.hover = i;
  if (i >= 0) gsap.to(cards[i].mesh.material.uniforms.uHover, { value: 1, duration: dur, ease: 'power2.out' });
  canvas.classList.toggle('pt', i >= 0);
}
function bindInput(canvas) {
  let wheelAcc = 0, wheelT = 0;
  addEventListener('wheel', e => {                 // anywhere on the home page, not only over the canvas (the corner labels sit on top)
    if (S.open !== null) return;
    e.preventDefault();
    // one mouse notch = half a card (the reference does a full card; Luka wanted two notches per card). Notch deltas differ by
    // mouse and OS (100 or 150 px here), so a notch is counted as an event, and trackpad crumbs accumulate to the same 40 px gate
    let d = e.deltaY + e.deltaX;
    if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= innerHeight;
    const now = performance.now();
    if (now - wheelT > 400) wheelAcc = 0;          // a new gesture
    wheelAcc += d; wheelT = now;
    if (Math.abs(wheelAcc) < 40) return;
    const steps = Math.sign(wheelAcc) * Math.max(1, Math.min(3, Math.floor(Math.abs(wheelAcc) / 160)));   // a huge single delta (fast trackpad) is worth up to 3
    S.sT = clamp(S.sT + steps * 0.5 * S.pitch, S.s - 3 * S.pitch, S.s + 3 * S.pitch);   // never more than ~3 cards ahead of the strip, never dropped
    S.vk = Math.min(0.5, S.vk + 0.08);
    wheelAcc = 0;
  }, { passive: false });
  canvas.addEventListener('pointerdown', e => {
    if (S.open !== null || hole.open) return;
    S.drag = { x: e.clientX, s: S.sT, lx: e.clientX, v: 0, t: performance.now() };
    S.moved = 0;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('grab');
  });
  canvas.addEventListener('pointermove', e => {
    if (S.drag) {
      const dx = e.clientX - S.drag.x, now = performance.now(), dtp = Math.max(0.004, (now - S.drag.t) / 1000);
      S.moved = Math.max(S.moved, Math.abs(dx));
      S.sT = S.drag.s - dx * pxToWorld();
      const pxs = Math.abs(e.clientX - S.drag.lx) / dtp;
      S.vd += (Math.tanh(pxs / 1900) - S.vd) * 0.4;
      S.drag.v = e.clientX - S.drag.lx; S.drag.lx = e.clientX; S.drag.t = now;
    } else if (S.open === null && !hole.open) setHover(pick(e), canvas);
  });
  const up = e => {
    if (!S.drag) return;
    const d = S.drag; S.drag = null; canvas.classList.remove('grab');
    if (S.moved < 5) { const i = pick(e); if (i >= 0) openProject(i); }
    else snap(-d.v * 6 * pxToWorld());
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (!S.drag) setHover(-1, canvas); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && hole.open) return openHole(false);
    if (e.key === 'Escape' && S.open !== null) return closeProject();
    if (S.open !== null) { if (e.key === 'ArrowRight') switchProject(1); if (e.key === 'ArrowLeft') switchProject(-1); return; }
    if (e.key === 'ArrowRight') { S.sT += S.pitch; S.vk = Math.min(0.5, S.vk + 0.14); }
    if (e.key === 'ArrowLeft') { S.sT -= S.pitch; S.vk = Math.min(0.5, S.vk + 0.14); }
    if (e.key === 'Enter') { const i = frontIndex(); if (i >= 0) openProject(i); }
  });
}

// ---------------------------------------------------------------- mobile stack
function buildStack() {
  const ul = $('#stack'); ul.innerHTML = '';
  items().forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="sc" type="button"><img src="${(p.home && p.home.img) || p.cover}" alt="" loading="lazy" onerror="this.remove()"><span class="nm"><b>${T(p).title}</b><small>${p.cats.join(', ')}</small></span><i>&rarr;</i></button>`;
    li.firstElementChild.addEventListener('click', e => openProject(i, e.currentTarget.getBoundingClientRect()));
    ul.append(li);
  });
  setTimeout(dismissPre, 500);
}
const stackRect = i => $('#stack').children[i]?.firstElementChild.getBoundingClientRect();

// ---------------------------------------------------------------- panel
const panel = $('#panel'), ghost = $('#ghost'), dimEl = $('#dim'), hero = $('#pHero'), fades = panel.querySelectorAll('.fade');
const pr = $('#pScroll'), prc = $('#pContent'), spin = $('#ring'), slivers = [$('#prevP'), $('#nextP')];
const ringArc = spin.querySelector('.arc'), ringGho = spin.querySelector('.gho'), RING_C = 100.53;
// the gallery column loops (reference): a second copy, one viewport tall, follows the content, so Lenis' infinite range is exactly one period
function buildLoop() {
  prc.querySelector('.dup')?.remove();
  if (S.mobile) return;
  const dup = document.createElement('div'); dup.className = 'dup';
  const hf = hero.closest('figure').cloneNode(true); hf.querySelector('img').removeAttribute('id'); hf.classList.add('in');
  dup.append(hf, ...[...$('#pBody').children].map(n => { const c = n.cloneNode(true); if (c.tagName === 'FIGURE') c.classList.add('in'); return c; }));
  prc.appendChild(dup);
  sizeLoop();
}
function sizeLoop() {
  const dup = prc.querySelector('.dup'); if (!dup) return;
  dup.style.height = Math.max(0, pr.clientHeight - 40) + 'px';   // 40 = .prc padding-top: total scroll range = one period + one viewport
}
function setRect(el, r) { el.style.left = r.x + 'px'; el.style.top = r.y + 'px'; el.style.width = r.width + 'px'; el.style.height = r.height + 'px'; }
function targetRect() {
  const w = innerWidth, h = innerHeight;
  return S.mobile ? { x: w * 0.03, y: h * 0.015, width: w * 0.94, height: h * 0.97 }
                  : { x: w * 0.033, y: h * 0.0225, width: w * 0.934, height: h * 0.955 };   // 45/18 px at 1366x800, like the reference
}
function fill(p) {
  const t = T(p);
  $('#pTitle').textContent = t.title;
  $('#pBlurb').textContent = t.blurb;
  $('#pChips').innerHTML = (p.link ? `<li class="lnk"><a href="${p.link}" target="_blank" rel="noopener" aria-label="Open live project">&#8599;</a></li>` : '') +
    [p.year, p.client, ...p.cats].filter(Boolean).map(t => `<li>${t}</li>`).join('');
  spin.classList.add('on');
  hero.onload = () => spin.classList.remove('on');
  hero.src = p.cover; hero.alt = t.title + ' cover';
  if (hero.complete) spin.classList.remove('on');
  $('#pBody').innerHTML =
    t.sections.map(s => `<div class="txt"><h3>${s.h}</h3><p>${s.t}</p></div>`).join('') +
    p.gallery.map(g => `<figure><img src="${g}" alt="" loading="lazy"></figure>`).join('');
  buildLoop();
  pr.scrollTop = 0; panel.scrollTop = 0;
  if (lenis) lenis.scrollTo(0, { immediate: true });
  // gallery images rise in as they enter
  io?.disconnect();
  io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { root: S.mobile ? panel : pr, rootMargin: '0px 0px -8% 0px' });
  $('#pBody').querySelectorAll('figure').forEach(f => (RM ? f.classList.add('in') : io.observe(f)));
  if (panel.classList.contains('on')) buildPanelPlanes();      // needs the panel laid out; openProject builds after it sizes the panel
}

// ---------------------------------------------------------------- panel content as GL planes (the reference renders its inner page in WebGL,
// so the cursor trail touches images and text alike); the hidden DOM keeps the layout, the planes follow its rects every frame
let pplanes = [], ghosts = [], planeT = 0;      // ghosts: the previous project's planes riding out on its sheet during a prev/next switch
const planeGeo = new THREE.PlaneGeometry(1, 1, 1, 24);   // vertical segments: the planes bow with the sheet while the panel scrolls
const op = el => parseFloat(getComputedStyle(el).opacity) || 0;
function panelPlane(el, fader, clip, radius, group) {
  const mat = cardMaterial(true), u = mat.uniforms;
  u.uP.value = 0; u.uShade.value = 0; u.uArrow.value = 0; u.uAlpha.value = 0;
  const mesh = new THREE.Mesh(planeGeo, mat); mesh.renderOrder = 12; mesh.frustumCulled = false; mesh.visible = false;
  scene.add(mesh);
  // k: entrance alpha, rise: entrance lift (px), ride: a card whose deviation from the panel pose carries this plane (content on a moving sheet)
  const p = { mesh, el, fader, clip, radius, group, img: null, k: 1, rise: 0, ride: null };
  pplanes.push(p); return p;
}
function buildPanelPlanes() {
  disposePanelPlanes();
  if (S.mobile || !renderer || !panel.classList.contains('on')) return;
  for (const img of prc.querySelectorAll('figure img')) {
    const p = panelPlane(img, img.closest('figure'), true, 0, 'img');   // square corners, like the reference's inner pages
    new THREE.TextureLoader().load(img.getAttribute('src'), tex => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      p.mesh.material.uniforms.uMap.value = tex; p.mesh.material.uniforms.uHasMap.value = 1; p.img = tex.image;
    });
  }
  // the text column is three planes (title, blurb, chips) so they can enter one after another, as the reference's do
  const groups = [[$('#pTitle'), 'title'], [$('#pBlurb'), 'blurb'], [$('#pChips'), 'chips'], ...[...prc.querySelectorAll('.txt')].map(el => [el, 'txt'])];
  for (const [el, group] of groups) {
    const p = panelPlane(el, null, group === 'txt', 0, group);
    p.isPl = group === 'chips';
    const tex = new THREE.CanvasTexture(rasterBlock(el));
    tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = tex.magFilter = THREE.LinearFilter;
    p.mesh.material.uniforms.uMap.value = tex; p.mesh.material.uniforms.uHasMap.value = 1;
  }
  panel.classList.add('gl');
}
// the reference's page choreography (its "title at .25 / text at .35 / pills at .5" config, expo eases): images come with the sheet,
// then the title, the blurb and the chips rise in one after another
function enterPlanes(tl, at, D, ride) {
  for (const p of pplanes) {
    p.k = 0;
    if (p.group === 'img' || p.group === 'txt') { p.ride = ride || null; tl.to(p, { k: 1, duration: 0.6 * D, ease: 'power2.out' }, (at + 0.1) * D); continue; }
    const [t, dur, lift] = p.group === 'title' ? [0.25, 1.0, 28] : p.group === 'blurb' ? [0.35, 0.9, 22] : [0.5, 0.85, 18];
    p.rise = lift;
    tl.to(p, { k: 1, rise: 0, duration: dur * D, ease: 'expo.out' }, (at + t) * D);
  }
}
// rasterise a laid-out text block exactly as the browser wrapped it: backgrounds (chips) as rounded rects, then every word at its own DOM rect
function rasterBlock(el) {
  const R = el.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(R.width * dpr)); c.height = Math.max(1, Math.round(R.height * dpr));
  const x = c.getContext('2d'); x.scale(dpr, dpr);
  for (const e of el.querySelectorAll('*')) {
    const cs = getComputedStyle(e), bg = cs.backgroundColor;
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') continue;
    const r = e.getBoundingClientRect(), rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.height / 2, r.width / 2);
    x.fillStyle = bg; x.beginPath(); x.roundRect(r.left - R.left, r.top - R.top, r.width, r.height, rad); x.fill();
  }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), range = document.createRange();
  let n;
  while ((n = walker.nextNode())) {
    const s = n.nodeValue; if (!s.trim()) continue;
    const cs = getComputedStyle(n.parentElement);
    x.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    x.fillStyle = cs.color; x.textBaseline = 'alphabetic';
    x.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
    const ascent = x.measureText('Hg').fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
    const up = cs.textTransform === 'uppercase', re = /\S+/g;
    let m;
    while ((m = re.exec(s))) {
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      const rr = range.getClientRects()[0]; if (!rr) continue;
      x.fillText(up ? m[0].toUpperCase() : m[0], rr.left - R.left, rr.top - R.top + ascent);
    }
  }
  return c;
}
function disposePlane(p) { scene.remove(p.mesh); p.mesh.material.uniforms.uMap.value?.dispose(); p.mesh.material.dispose(); gsap.killTweensOf(p); }
function disposePanelPlanes() {
  for (const p of pplanes) disposePlane(p);
  pplanes = []; panel.classList.remove('gl'); clearPills();
}
function disposeGhosts() { for (const p of ghosts) disposePlane(p); ghosts = []; }
function syncPanelPlanes() {
  if (openCard) { const ou = openCard.mesh.material.uniforms; ou.uBulgeA.value = bulge; ou.uBulgeH.value = S.Hh; }   // the white sheet bows with the scroll speed, its content with it
  if (!pplanes.length && !ghosts.length) return;
  const prR = pr.getBoundingClientRect();
  const yTop = -((prR.top / innerHeight) * 2 - 1) * S.Hh, yBot = -((prR.bottom / innerHeight) * 2 - 1) * S.Hh;
  const pOp = op(panel), prOp = op(pr), plOp = op(panel.querySelector('.pl')), pxw = pxToWorld();
  const R = worldRect(targetRect());                                    // the panel pose, which a riding sheet deviates from
  for (const p of ghosts.length ? [...pplanes, ...ghosts] : pplanes) {
    const r = p.frozen || p.el.getBoundingClientRect(), u = p.mesh.material.uniforms;
    if (r.width < 2 || u.uHasMap.value < 0.5 || p.k <= 0.001 || (p.clip && (r.bottom < prR.top - 2 || r.top > prR.bottom + 2))) { p.mesh.visible = false; continue; }
    const w = worldRect(r);
    let k = 1, dx = 0, dy = 0, dim = 0;
    if (p.ride) {                                                        // carried by a sheet that is sliding / scaling toward or away from the panel pose
      const rm = p.ride.mesh; k = rm.scale.x / R.sx; dx = rm.position.x - R.x; dy = rm.position.y - R.y; dim = p.ride.mesh.material.uniforms.uDim.value;
    }
    p.mesh.position.set(R.x + dx + (w.x - R.x) * k, R.y + dy + (w.y - R.y) * k + p.rise * pxw, 0.002);
    p.mesh.scale.set(w.sx * k, w.sy * k, 1);
    u.uAspect.value.set(w.sx * k, w.sy * k); u.uRadius.value = p.radius * pxw * k; u.uDim.value = dim;
    u.uBulgeA.value = bulge * (p.img ? IMG_BULGE : 1); u.uBulgeH.value = S.Hh;
    if (p.isPl && !p.frozen) syncPills(r, w, u);
    if (p.clip) u.uClipY.value.set(R.y + dy + (yBot - R.y) * k, R.y + dy + (yTop - R.y) * k);
    u.uAlpha.value = (p.frozen ? p.fop : p.fader ? op(p.fader) : 1) * (p.clip ? prOp : plOp) * pOp * p.k;
    const im = p.img;
    if (im) { const ia = im.width / im.height, ca = w.sx / w.sy;
      if (ia > ca) { u.uRepeat.value.set(ca / ia, 1); u.uOffset.value.set((1 - ca / ia) / 2, 0); } else { u.uRepeat.value.set(1, ia / ca); u.uOffset.value.set(0, (1 - ia / ca) / 2); } }
    p.mesh.visible = true;
  }
}
// chip hover (the reference's pills): hit-test the hidden chips by rect, tween a hover value per chip (in 0.7 s expo, out 0.5 s expo),
// keep the pointer position so the disc and the lens follow it; two slots so a chip can fade out while its neighbour fades in
const pills = [null, null];
let pillNow = null;
function pillFor(li) {              // a free slot, else the one that has faded the furthest
  let slot = pills.findIndex(p => !p);
  if (slot < 0) slot = pills[0].hover <= pills[1].hover ? 0 : 1;
  if (pills[slot]) gsap.killTweensOf(pills[slot]);
  const p = { el: li, hover: 0, px: 0, py: 0, lx: 0, ly: 0, round: li.classList.contains('lnk') };
  pills[slot] = p; return p;
}
function hoverPills(x, y) {
  let hit = null;
  if (S.open !== null && !S.mobile && pplanes.length) {
    for (const li of panel.querySelectorAll('#pChips li')) {
      const r = li.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { hit = li; break; }
    }
  }
  if (hit && pillNow?.el === hit) { pillNow.px = x; pillNow.py = y; return; }
  if (pillNow) { gsap.to(pillNow, { hover: 0, duration: RM ? 0 : 0.5, ease: 'expo.out', overwrite: 'auto' }); pillNow = null; }
  if (hit) {
    const p = pillFor(hit); p.px = x; p.py = y; pillNow = p;
    const r = hit.getBoundingClientRect(); p.lx = (x - (r.left + r.width / 2)) * 0.33; p.ly = (y - (r.top + r.height / 2)) * 0.33;
    gsap.to(p, { hover: 1, duration: RM ? 0 : 0.7, ease: 'expo.out', overwrite: 'auto' });
  }
}
addEventListener('pointermove', e => hoverPills(e.clientX, e.clientY));
// per frame: the hovered chips' rects, in the .pl plane's own units (world, origin bottom-left), into the plane's uniforms
function syncPills(R, w, u) {
  const k = w.sx / R.width, dt = gsap.ticker.deltaRatio(60) / 60;
  for (let i = 0; i < 2; i++) {
    const p = pills[i], A = u.uPillA.value[i];
    if (!p || p.hover < 0.001 || !p.el.isConnected) { A.set(0, 0); continue; }
    const r = p.el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const f = 1 - Math.exp(-11 * dt);                                              // the lens follows the pointer at the reference's rate
    p.lx += ((p.px - cx) * 0.33 - p.lx) * f; p.ly += ((p.py - cy) * 0.33 - p.ly) * f;
    const rad = Math.min(parseFloat(getComputedStyle(p.el).borderRadius) || 0, r.height / 2, r.width / 2);
    const corner = Math.hypot(r.width / 2 - rad, r.height / 2 - rad) + rad;        // disc radius: past the far corner from the lens centre
    const disc = corner + Math.hypot(p.lx, p.ly) + (p.round ? 0 : 0.1 * Math.max(r.width, r.height) * 0.5);
    u.uPillBox.value[i].set((cx - R.left) * k, (R.bottom - cy) * k, r.width / 2 * k, r.height / 2 * k);
    u.uPillDisc.value[i].set((cx + p.lx - R.left) * k, (R.bottom - cy - p.ly) * k, disc * k, rad * k);
    A.set(p.hover, p.round ? 0 : 1);
  }
}
function clearPills() { for (const p of pills) if (p) gsap.killTweensOf(p); pills[0] = pills[1] = null; pillNow = null; }
window.__pills = pills; window.__pplanes = () => pplanes; window.__bulge = () => bulge; window.__lenis = () => lenis;

// panel scroll: Lenis on the gallery column, but it listens on the whole panel, so the wheel works over the text column too (like the reference)
let bulge = 0, lastScroll = 0;
const IMG_BULGE = 1;   // measured on the reference mid-scroll: image edges bow exactly as much as the sheet's (the trace's larger value belongs elsewhere)
function startLenis() {
  if (S.mobile || RM || !window.Lenis) return;
  lenis = new Lenis({ wrapper: pr, content: prc, eventsTarget: panel, lerp: 0.1, smoothWheel: true, infinite: !!prc.querySelector('.dup') });
  lastScroll = 0; let lastProg = 0;
  lenis._raf = (t, dms) => {
    lenis.raf(t * 1000);
    // the sheet's bow follows the scroll speed (reference setScroll: i = tanh(v / 900 px/s), bulge = i|i| x 0.22 x frustum half-height)
    const dt = Math.min(0.05, (dms || 16.7) / 1000), sc = lenis.scroll ?? 0, lim = lenis.limit || 1;   // lenis.scroll is the wrapped value; animatedScroll only wraps once the motion ends
    let dsc = sc - lastScroll; if (Math.abs(dsc) > lim / 2) dsc -= Math.sign(dsc) * lim;   // the loop's seam is not a jump
    const v = dsc / dt; lastScroll = sc;
    // progress ring: the arc fills over one period; at the seam the full ring fades out as the new one starts (reference "rings")
    if (!spin.classList.contains('on')) {
      const prog = clamp(sc / lim, 0, 1);
      if (Math.abs(prog - lastProg) > 0.5) {
        ringGho.style.strokeDashoffset = RING_C * (1 - lastProg);
        gsap.fromTo(ringGho, { opacity: 1 }, { opacity: 0, duration: 0.45, ease: 'power2.out', overwrite: true });
      }
      ringArc.style.strokeDashoffset = RING_C * (1 - prog); lastProg = prog;
    }
    const i = Math.tanh(v / 4700);                     // 4700 (not the reference's 900, whose velocity is in other units): one 300 px notch peaks at ~2.75% of Hh, as in the reference trace
    const raw = i * Math.abs(i) * 0.15 * S.Hh;       // reference 0.22; Luka: "good but too much, a little more subtle"
    // never into the side sheets (23 px gap): the mid-height edge may travel at most 19 px, so cap the depth that perspective turns into that width
    const T = targetRect(), m = 19 / (T.width / 2), cap = CAMZ * m / (1 + m);
    const target = cap * Math.tanh(raw / cap);
    bulge += (target - bulge) * (1 - Math.exp(-dt / 0.06));
  };
  gsap.ticker.add(lenis._raf);
}
function stopLenis() {
  if (!lenis) return;
  gsap.ticker.remove(lenis._raf); lenis.destroy(); lenis = null; bulge = 0;
}
// world transform that makes a unit plane fill rect T (px) on the z = 0 plane
function worldRect(T) {
  return {
    x: ((T.x + T.width / 2) / innerWidth * 2 - 1) * S.Wh,
    y: -((T.y + T.height / 2) / innerHeight * 2 - 1) * S.Hh,
    sx: (T.width / innerWidth) * 2 * S.Wh, sy: (T.height / innerHeight) * 2 * S.Hh,
  };
}
function placeAsPanel(c, T) {
  const r = worldRect(T), u = c.mesh.material.uniforms;
  c.mesh.position.set(r.x, r.y, 0); c.mesh.scale.set(r.sx, r.sy, 1);
  u.uP.value = 0; u.uWhite.value = 1; u.uDim.value = 0; u.uHover.value = 0; u.uAspect.value.set(r.sx, r.sy);
  u.uBulgeH.value = S.Hh;
  c.mesh.renderOrder = 10; c.mesh.visible = true;
}
function restoreCard(c) {
  const u = c.mesh.material.uniforms;
  c.mesh.scale.set(S.W, S.H, 1); u.uP.value = 1; u.uWhite.value = 0; u.uAspect.value.set(S.W, S.H);
  u.uDim.value = S.dim; u.uHover.value = 0; u.uBulgeA.value = 0; u.uBulgeH.value = 0;
  c.mesh.renderOrder = 0;
}
const slotX = c => { let x = c.i * S.pitch - S.s; return ((x + S.L / 2) % S.L + S.L) % S.L - S.L / 2; };
function sideCards(i) { const L = cards.length; return L < 3 ? {} : { prev: cards[(i - 1 + L) % L], next: cards[(i + 1) % L] }; }
function sidePose(r, dir) {                  // a side sheet sits beside the panel with a 23 px gap, 81% of its size
  const gap = 23 * pxToWorld();
  return { x: dir * (r.sx / 2 + SIDE_SCALE * r.sx / 2 + gap), y: r.y, sx: SIDE_SCALE * r.sx, sy: SIDE_SCALE * r.sy };
}
// tween a card to a pose on the panel row (position, size, sheet off, white wash, dim)
function toPose(tl, c, pose, { white = 1, dim = 0, order = 5, dur = 1, at = 0, D = 1, ease = 'expo.out' } = {}) {
  const u = c.mesh.material.uniforms;
  c.mesh.renderOrder = order; c.mesh.visible = true; held.add(c);
  tl.to(c.mesh.position, { x: pose.x, y: pose.y, z: 0, duration: dur * D, ease }, at * D)
    .to(c.mesh.scale, { x: pose.sx, y: pose.sy, duration: dur * D, ease, onUpdate: () => u.uAspect.value.set(c.mesh.scale.x, c.mesh.scale.y) }, at * D)
    .to(u.uP, { value: 0, duration: 0.7 * D, ease: 'expo.out' }, at * D)
    .to(u.uHover, { value: 0, duration: 0.3 * D }, at * D)
    .to(u.uWhite, { value: white, duration: 0.5 * D, ease: 'power3.out' }, (at + 0.1) * D)
    .to(u.uDim, { value: dim, duration: 0.6 * D, ease: 'power2.out' }, (at + 0.1) * D);
}
// tween a card back to its slot on the strip
function toSlot(tl, c, { at = 0.05, D = 1 } = {}) {
  const u = c.mesh.material.uniforms;
  tl.to(c.mesh.position, { x: slotX(c), y: 0, z: 0, duration: 1.0 * D, ease: 'expo.inOut' }, at * D)
    .to(c.mesh.scale, { x: S.W, y: S.H, duration: 1.0 * D, ease: 'expo.inOut', onUpdate: () => u.uAspect.value.set(c.mesh.scale.x, c.mesh.scale.y) }, at * D)
    .to(u.uP, { value: 1, duration: 0.9 * D, ease: 'power2.inOut' }, (at + 0.1) * D)
    .to(u.uWhite, { value: 0, duration: 0.5 * D, ease: 'power1.out' }, (at + 0.15) * D)
    .to(u.uDim, { value: 0, duration: 0.6 * D }, (at + 0.25) * D);
}

let busy = false;
async function openProject(i, fromRect) {
  if (busy || S.open !== null) return; busy = true;
  const p = items()[i];
  S.open = i;
  fill(p);
  const T = targetRect();
  const D = RM ? 0 : 1;
  document.body.classList.add('lock');

  if (S.mobile) {                                   // DOM shared-element on mobile
    panel.classList.add('on'); setRect(panel, T); panel.style.visibility = 'hidden';
    await new Promise(r => requestAnimationFrame(r));
    const heroR = hero.getBoundingClientRect();
    panel.style.visibility = ''; setRect(panel, fromRect); panel.style.opacity = 0; gsap.set(fades, { opacity: 0 });
    ghost.src = p.cover; setRect(ghost, fromRect); ghost.style.opacity = 1; dimEl.style.pointerEvents = 'auto';
    const tl = gsap.timeline({ onComplete: () => { ghost.style.opacity = 0; busy = false; } });
    tl.to(panel, { left: T.x, top: T.y, width: T.width, height: T.height, opacity: 1, duration: 1.0 * D, ease: 'expo.out' }, 0)
      .to(ghost, { left: heroR.x, top: heroR.y, width: heroR.width, height: heroR.height, duration: 1.0 * D, ease: 'expo.out' }, 0)
      .to(dimEl, { opacity: 0.62, duration: 0.8 * D }, 0)
      .to('.nav', { opacity: 0, duration: 0.4 * D }, 0)
      .to(fades, { opacity: 1, duration: 0.5 * D, stagger: 0.05 }, 0.45 * D)
      .fromTo('#close', { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.6 * D, ease: 'back.out(2)' }, 0.55 * D);
    if (RM) tl.progress(1);
    return;
  }

  // desktop (measured on the reference): the card grows into the white panel (sheet expo.out 0.7 s, white power3.out 0.5 s from 0.13 s);
  // prev/next wash to grey, scale up and park beside it as side sheets; the rest of the strip fades; content shows at ~1.0 s
  const c = cards[i]; openCard = c;
  if (S.hover >= 0) setHover(-1, $('#gl'));
  const r = worldRect(T);
  panel.classList.add('on'); setRect(panel, T); panel.style.opacity = 0; gsap.set(fades, { opacity: 1, x: 0 });   // the GL planes do their own entrance
  sizeLoop();                                        // the panel has its size now
  buildPanelPlanes();
  startLenis();
  sides = sideCards(i);
  const tl = gsap.timeline({ onComplete: () => { busy = false; slivers.forEach(s => s.classList.add('on')); } });
  toPose(tl, c, { x: r.x, y: r.y, sx: r.sx, sy: r.sy }, { white: 1, dim: 0, order: 10, D });
  if (sides.prev) toPose(tl, sides.prev, sidePose(r, -1), { white: 1, dim: SIDE_DIM, D });
  if (sides.next) toPose(tl, sides.next, sidePose(r, 1), { white: 1, dim: SIDE_DIM, D });
  tl.to(S, { dim: 1, duration: 0.5 * D, ease: 'power2.out' }, 0)
    .to(grid.material.uniforms.uDimF, { value: 0, duration: 0.5 * D }, 0)
    .to('.nav', { opacity: 0, duration: 0.4 * D }, 0)
    .to(panel, { opacity: 1, duration: 0.3 * D }, 0.85 * D)
    .fromTo('#close', { scale: 0, rotation: -90 }, { scale: 1, rotation: 0, duration: 0.6 * D, ease: 'back.out(2)' }, 1.05 * D);
  enterPlanes(tl, 0.75, D, null);                     // images at ~0.85 s, title 1.0, blurb 1.1, chips 1.25 (content shows at ~1 s like the reference)
  if (RM) tl.progress(1);
}

function closeProject() {
  if (busy || S.open === null) return; busy = true;
  const i = S.open, D = RM ? 0 : 1;
  slivers.forEach(s => s.classList.remove('on'));
  const done = () => {
    disposePanelPlanes(); disposeGhosts();
    panel.classList.remove('on'); panel.style.opacity = ''; ghost.style.opacity = 0;
    document.body.classList.remove('lock'); dimEl.style.pointerEvents = 'none';
    if (openCard) { restoreCard(openCard); openCard = null; }
    S.open = null; busy = false;
  };

  if (S.mobile) {
    const src = stackRect(i), T = targetRect(), heroR = hero.getBoundingClientRect();
    const useGhost = heroR.bottom > T.y + 40 && heroR.top < T.y + T.height;
    if (useGhost) { setRect(ghost, heroR); ghost.style.opacity = 1; }
    const tl = gsap.timeline({ onComplete: done });
    tl.to(fades, { opacity: 0, duration: 0.25 * D }, 0)
      .to('#close', { scale: 0, rotation: 90, duration: 0.3 * D, ease: 'power2.in' }, 0)
      .to(panel, { left: src.x, top: src.y, width: src.width, height: src.height, opacity: 0, duration: 0.85 * D, ease: 'expo.inOut' }, 0.05 * D)
      .to(dimEl, { opacity: 0, duration: 0.7 * D }, 0.1 * D)
      .to('.nav', { opacity: 1, duration: 0.5 * D }, 0.3 * D);
    if (useGhost) tl.to(ghost, { left: src.x, top: src.y, width: src.width, height: src.height, duration: 0.85 * D, ease: 'expo.inOut' }, 0.05 * D)
                    .to(ghost, { opacity: 0, duration: 0.25 * D }, 0.7 * D);
    if (RM) tl.progress(1);
    return;
  }

  stopLenis();
  const c = openCard;
  S.open = -1;                                        // not null yet: input stays locked while the strip comes back
  const release = [c, ...Object.values(sides)];
  const tl = gsap.timeline({ onComplete: () => { for (const x of release) { restoreCard(x); held.delete(x); } sides = {}; done(); } });
  tl.to(fades, { opacity: 0, duration: 0.2 * D }, 0)
    .to('#close', { scale: 0, rotation: 90, duration: 0.3 * D, ease: 'power2.in' }, 0)
    .to(panel, { opacity: 0, duration: 0.25 * D }, 0.05 * D);
  for (const x of release) toSlot(tl, x, { D });
  tl.to(S, { dim: 0, duration: 0.8 * D, ease: 'power2.out' }, 0.25 * D)
    .to(grid.material.uniforms.uDimF, { value: 1, duration: 0.8 * D }, 0.25 * D)
    .to('.nav', { opacity: 1, duration: 0.5 * D }, 0.4 * D);
  if (RM) tl.progress(1);
}

// prev / next while a project is open (the slivers at the edges, or arrow keys)
function switchProject(dir) {
  if (busy || S.open === null || S.mobile || !sides.next) return; busy = true;
  const L = items(), N = L.length, ni = (S.open + dir + N) % N, D = RM ? 0 : 1;
  const T = targetRect(), r = worldRect(T);
  const old = openCard, incoming = dir > 0 ? sides.next : sides.prev, outgoing = dir > 0 ? sides.prev : sides.next;
  const fresh = cards[(ni + dir + N) % N];
  S.s = S.sT = ni * S.pitch; S.vel = 0;             // park the strip on the new project, so closing lands there
  const tl = gsap.timeline({ onComplete: () => { busy = false; } });
  // the whole row slides one step (reference: settled in ~0.5 s): old panel becomes a side sheet with its content still on it,
  // the clicked side becomes the panel with its images on board, the far side leaves, a fresh one arrives from beyond the edge
  const SW = 0.6;
  toPose(tl, old, sidePose(r, -dir), { white: 1, dim: SIDE_DIM, order: 5, dur: SW, D });
  toPose(tl, incoming, { x: r.x, y: r.y, sx: r.sx, sy: r.sy }, { white: 1, dim: 0, order: 10, dur: SW, D });
  if (outgoing && outgoing !== fresh) {
    const far = sidePose(r, -dir), u = outgoing.mesh.material.uniforms;
    tl.to(outgoing.mesh.position, { x: far.x * 2.2, duration: SW * D, ease: 'expo.out' }, 0)
      .to(u.uDim, { value: 1, duration: 0.35 * D }, 0)
      .add(() => { restoreCard(outgoing); held.delete(outgoing); outgoing.mesh.visible = false; }, SW * D);
  }
  if (fresh !== old && fresh !== incoming) {
    const p = sidePose(r, dir), u = fresh.mesh.material.uniforms;
    fresh.mesh.position.set(p.x * 2.2, p.y, 0); fresh.mesh.scale.set(p.sx, p.sy, 1);
    u.uAspect.value.set(p.sx, p.sy); u.uWhite.value = 1; u.uDim.value = 1; u.uP.value = 0;
    toPose(tl, fresh, p, { white: 1, dim: SIDE_DIM, order: 5, dur: SW, D });
  }
  sides = dir > 0 ? { prev: old, next: fresh } : { prev: fresh, next: old };
  openCard = incoming; S.open = ni;
  // the old content rides out on the old sheet and fades; the new content is built now and enters with the reference's stagger
  disposeGhosts();
  ghosts = pplanes; pplanes = [];
  for (const g of ghosts) {                            // frozen at their last layout: fill() is about to swap the DOM under them
    g.frozen = g.el.getBoundingClientRect(); g.fop = g.fader ? op(g.fader) : 1; g.ride = old;
    tl.to(g, { k: 0, duration: 0.35 * D, ease: 'power1.out' }, 0.05 * D);
  }
  tl.add(() => disposeGhosts(), (SW + 0.05) * D);
  fill(L[ni]);
  enterPlanes(tl, 0, D, incoming);
  tl.add(() => { for (const p of pplanes) p.ride = null; }, SW * D);   // landed: the planes follow the panel rects directly again
  if (RM) tl.progress(1);
}
// hovering a side sheet lifts its wash a little
for (const [el, key] of [[slivers[0], 'prev'], [slivers[1], 'next']]) {
  el.addEventListener('pointerenter', () => sides[key] && gsap.to(sides[key].mesh.material.uniforms.uDim, { value: 0.5, duration: 0.4, ease: 'power2.out' }));
  el.addEventListener('pointerleave', () => sides[key] && gsap.to(sides[key].mesh.material.uniforms.uDim, { value: SIDE_DIM, duration: 0.5, ease: 'power2.out' }));
}
$('#close').addEventListener('click', closeProject);
dimEl.addEventListener('click', closeProject);
$('#prevP').addEventListener('click', () => switchProject(-1));
$('#nextP').addEventListener('click', () => switchProject(1));

// ---------------------------------------------------------------- close button, measured on the reference: a light pill grows from the centre
// in ~350 ms (eased out) while the mark slides out and a new one slides in ~60 ms behind; everything returns in ~300 ms
{
  const b = $('#close'), pill = b.querySelector('.pill'), mk = b.querySelector('.mk'), [m1, m2] = mk.querySelectorAll('i');
  gsap.set(m2, { yPercent: 260 });                  // parked outside the 40 px button (the mark is 12 px tall, the button clips)
  let hov = null;
  const d = (v) => (RM ? 0 : v);
  b.addEventListener('pointermove', e => {      // the pill is centred on the pointer (u_pillDisc), so it grows from where you enter and follows
    const r = b.getBoundingClientRect(), rad = r.width / 2;
    let dx = e.clientX - r.left - rad, dy = e.clientY - r.top - rad;
    const len = Math.hypot(dx, dy); if (len > rad) { dx *= rad / len; dy *= rad / len; }
    gsap.to(pill, { x: dx, y: dy, duration: 0.25, ease: 'power2.out' });
  });
  b.addEventListener('pointerenter', () => {
    hov?.kill();
    hov = gsap.timeline()
      .to(pill, { scale: 1, duration: d(0.35), ease: 'power2.out' }, 0)
      .to(m1, { yPercent: -260, duration: d(0.35), ease: 'power2.out' }, 0)
      .to(m2, { yPercent: 0, duration: d(0.35), ease: 'power2.out' }, d(0.06))
      .to(mk, { scale: 1.12, duration: d(0.35), ease: 'power2.out' }, 0);
  });
  b.addEventListener('pointerleave', () => {
    hov?.kill();
    hov = gsap.timeline()
      .to(pill, { scale: 0, duration: d(0.3), ease: 'power2.out' }, 0)
      .to(m2, { yPercent: 260, duration: d(0.35), ease: 'power2.out' }, 0)
      .to(m1, { yPercent: 0, duration: d(0.35), ease: 'power2.out' }, d(0.06))
      .to(mk, { scale: 1, duration: d(0.3), ease: 'power2.out' }, 0);
  });
}

// ---------------------------------------------------------------- mode toggle
function setMode(m) {
  if (m === mode || S.open !== null) return; mode = m;
  $('#mF').setAttribute('aria-pressed', m === 'featured');
  $('#mA').setAttribute('aria-pressed', m === 'full');
  if (S.mobile) buildStack(); else buildRing();
}
// ---------------------------------------------------------------- the hole: Profile and Contact overlays (reference: openHole .85 s in / .65 s out,
// squash -0.1 -> 0 in .3 s; the disc element gives the lens its centre and radius; the text rises once the hole is open)
const L = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[lang] || v.en) : v;
function fillDisc(what) {
  const o = overlays?.[what]; if (!o) return;
  $('#discLead').textContent = L(o.lead); $('#discMeta').textContent = L(o.meta);
  $('#discLinks').innerHTML = o.links.map(l => `<li><a href="${L(l.href)}" target="_blank" rel="noopener">${L(l.label)}</a></li>`).join('');
}
function openHole(on, what = hole.what || 'profile') {
  if (on && !overlays) return;
  if (on && hole.open && hole.what === what) return openHole(false);
  if (on) { hole.what = what; fillDisc(what); if (S.hover >= 0) setHover(-1, $('#gl')); }
  hole.open = on;
  disc.toggleAttribute('inert', !on); disc.setAttribute('aria-hidden', String(!on)); disc.classList.toggle('on', on);
  const D = RM ? 0 : 1;
  gsap.to(hole, { p: on ? 1 : 0, duration: (on ? 0.85 : 0.65) * D, ease: on ? 'power3.inOut' : 'power3.in', overwrite: 'auto' });
  gsap.to(hole, { s: on ? 0 : -0.1, duration: (on ? 0.3 : 0.25) * D, ease: 'power2.out', overwrite: 'auto' });
  applyLang();                                        // the active corner label reads "Close"
}
UI.en.close = 'Close'; UI.ge.close = 'დახურვა';
for (const [sel, what] of [['a[href="#profile"]', 'profile'], ['a[href="#contact"]', 'contact']]) {
  $(sel).addEventListener('click', e => { e.preventDefault(); if (S.open !== null) return; openHole(!(hole.open && hole.what === what), what); });
}
addEventListener('click', e => {                     // a click outside the disc closes it (links and the corner labels keep working)
  if (!hole.open || e.target.closest('.nav, .disc a')) return;
  const r = disc.getBoundingClientRect(); if (Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) <= r.width / 2) return;
  openHole(false);
});
// language toggle: relabel the corners, rebake the card titles, refill an open project (its planes rebuild from the new DOM)
$('#langBtn').addEventListener('click', () => {
  lang = lang === 'en' ? 'ge' : 'en';
  try { localStorage.setItem('lang', lang); } catch {}
  applyLang();
  if (S.mobile) { buildStack(); if (S.open !== null) fill(items()[S.open]); return; }
  if (hole.open) fillDisc(hole.what);
  for (const c of cards) if (c.img !== undefined) bake(c);
  if (S.open !== null && S.open >= 0) fill(items()[S.open]);
});
applyLang();
$('#mF').addEventListener('click', () => setMode('featured'));
$('#mA').addEventListener('click', () => setMode('full'));
$('#home').addEventListener('click', e => { e.preventDefault(); if (S.open !== null) closeProject(); });

// ---------------------------------------------------------------- boot
if (S.mobile) buildStack(); else initGL();
MQ.addEventListener('change', () => location.reload());
