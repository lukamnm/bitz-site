// build.mjs - turns the content files (edited in the admin at /admin, or by hand) into the data files the site reads:
//   content/projects/<slug>/project.json -> data/projects.json  (ordered by "order"; Georgian under i18n.ge)
//   content/blog/<slug>/post.json        -> data/stories.json   (newest first; Markdown body -> panel sections)
//   content/shots/*.json                 -> data/shots.json     (groups ordered by "order")
//   content/pages/profile.json, contact.json -> data/profile.json
// The content files keep the two locales as top-level keys: "en" (default) and "ka" (Georgian); the app calls Georgian "ge".
// Media paths are stored site-absolute ("/assets/...") for the admin's previews; the site lives in a sub-folder for now, so they become relative.
// usage: node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { bubbleFor, firstClip } from './bubbles.mjs';

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };
const rel = p => (typeof p === 'string' ? p.replace(/^\/(?=assets\/)/, '') : p);   // /assets/x -> assets/x
const has = v => v !== undefined && v !== null && v !== '';
const pick = (o, keys) => Object.fromEntries(keys.filter(k => has(o?.[k])).map(k => [k, o[k]]));

// Markdown -> plain-text panel sections: headings start a section, paragraphs and list items are its paragraphs
const inline = s => s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
  .replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/<[^>]+>/g, '').trim();
function sections(markdown) {
  const out = []; let cur = { h: '', t: [] }, para = [];
  const flush = () => { if (para.length) { cur.t.push(inline(para.join(' '))); para = []; } };
  for (const raw of (markdown || '').split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) { flush(); if (cur.t.length || cur.h) out.push(cur); cur = { h: inline(h[1]), t: [] }; continue; }
    if (!line) { flush(); continue; }
    const li = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) { flush(); cur.t.push('• ' + inline(li[1])); continue; }
    para.push(line.replace(/^>\s?/, ''));
  }
  flush(); if (cur.t.length) out.push(cur);
  return out.filter(s => s.t.length);
}
// the project's "About" text: paragraphs separated by blank lines, links written [text](https://...) -> escaped HTML paragraphs with real <a> links
const escH = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = text => String(text || '').split(/\r?\n\s*\r?\n/).map(p => p.replace(/\s*\r?\n\s*/g, ' ').trim()).filter(Boolean).map(p =>
  escH(p.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\\([\[\]()*_])/g, '$1'))
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`));
const seo = s => (s ? { title: s.title || '', description: s.description || '', image: s.image || null } : null);
// page addresses, relative to the site root, always with a trailing slash ("portfolio/brace/"); an address set in the admin wins
const addr = u => (has(u) ? String(u).trim().replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\/*$/, '/') : null);
const ymd = d => String(d || '').slice(0, 10).replace(/-/g, '/');

// ---------------------------------------------------------------- projects
const catNames = list => (list || []).map(c => String(c).replace(/&amp;/g, '&').trim()).filter(Boolean);   // names as chosen in the admin (the WordPress import left "&amp;")
// a gallery item is an image (a plain path) or a video { video, webm, poster, sound }; the poster defaults to the frame tools/galleryvideo.mjs makes
const vidPoster = v => v ? v.replace(/.(mp4|webm)$/i, '.webp') : null;
const gal = list => (list || []).map(g => typeof g === 'string' ? rel(g) : g.type === 'video' || g.video || g.webm
  ? { ...pick({ video: rel(g.video), webm: rel(g.webm), poster: rel(g.poster) || vidPoster(rel(g.video) || rel(g.webm)) }, ['video', 'webm', 'poster']), ...(g.sound ? { sound: true } : {}) } : rel(g.image)).filter(Boolean);
const coverVid = v => v && (v.video || v.webm) ? { coverVideo: { ...pick({ video: rel(v.video), webm: rel(v.webm) }, ['video', 'webm']), ...(v.sound ? { sound: true } : {}) } } : {};
const projects = [];
for (const slug of fs.existsSync('content/projects') ? fs.readdirSync('content/projects') : []) {
  const f = `content/projects/${slug}/project.json`; if (!fs.existsSync(f)) continue;
  const { en = {}, ka = {} } = read(f);
  const sec = list => (list || []).filter(s => has(s.t)).map(s => ({ h: s.h || '', t: s.t }));
  // one "About the project" block at the top (Luka, 2026-11-17); the older per-section texts still work as a fallback
  const ABOUT = { en: 'About the project', ka: 'პროექტის შესახებ' };
  const about = (o, L) => (has(o.about) ? [{ h: ABOUT[L], t: rich(o.about), rich: true }] : sec(o.sections));
  const kaSec = about(ka, 'ka');
  const credits = (en.credits || []).filter(c => has(c.name)).map((c, k) => ({ role: { en: c.role || '', ge: ka.credits?.[k]?.role || null }, name: c.name, link: has(c.link) ? c.link : null }));
  projects.push({
    slug, order: has(en.order) ? +en.order : 999, title: en.title || slug, featured: en.featured !== false, year: en.year || '', client: en.client || '',
    cats: catNames(en.cats), link: en.link || null, blurb: en.blurb || '', cover: rel(en.cover), ...coverVid(en.coverVideo), gallery: gal(en.gallery), sections: about(en, 'en'), credits,
    home: en.home && (en.home.img || en.home.video || en.home.webm) ? pick({ img: rel(en.home.img), video: rel(en.home.video), webm: rel(en.home.webm) }, ['img', 'video', 'webm']) : null,
    seo: seo(en.seo),
    url: { en: addr(en.url) || `portfolio/${slug}/`, ge: ka.title ? addr(ka.url) || `ge/portfolio/${slug}/` : null },
    i18n: { ge: { title: ka.title || null, blurb: ka.blurb || null, sections: kaSec.length ? kaSec : null, seo: seo(ka.seo) } },
  });
}
projects.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
write('data/projects.json', projects.map(({ order, ...p }) => p));

// ---------------------------------------------------------------- blog
const stories = [];
for (const slug of fs.existsSync('content/blog') ? fs.readdirSync('content/blog') : []) {
  const f = `content/blog/${slug}/post.json`; if (!fs.existsSync(f)) continue;
  const { en = {}, ka } = read(f);
  const kaOk = !!(ka && (ka.title || ka.body));
  stories.push({
    slug, date: en.date || '', title: { en: en.title || slug, ge: kaOk ? ka.title || null : null }, excerpt: { en: en.excerpt || '', ge: kaOk ? ka.excerpt || null : null },
    cover: rel(en.cover), categories: catNames(en.categories), hasGe: kaOk, sections: { en: sections(en.body), ge: kaOk ? sections(ka.body) : null },
    seo: { en: seo(en.seo), ge: kaOk ? seo(ka.seo) : null },
    url: { en: addr(en.url) || `blog/${ymd(en.date)}/${slug}/`, ge: kaOk ? addr(ka.url) || `ge/${ymd(en.date)}/${slug}/` : null },
  });
}
stories.sort((a, b) => String(b.date).localeCompare(String(a.date)));
write('data/stories.json', stories);

// ---------------------------------------------------------------- shots
const groups = [];
for (const file of fs.existsSync('content/shots') ? fs.readdirSync('content/shots').filter(f => f.endsWith('.json')) : []) {
  const { en = {}, ka = {} } = read(`content/shots/${file}`);
  const items = (en.items || []).filter(it => it.webm || it.mp4).map((it, k) => ({
    id: path.basename(it.webm || it.mp4).replace(/\.\w+$/, '').toLowerCase(), title: { en: it.title || '', ge: ka.items?.[k]?.title || null }, sound: it.sound !== false,
    video: pick({ webm: rel(it.webm), mp4: rel(it.mp4) }, ['webm', 'mp4']),
  }));
  if (!items.length) continue;
  // bubble: the still + hover loop made from the first clip by tools/bubbles.mjs; a "Bubble image" set in the admin replaces the still
  const b = bubbleFor(firstClip(en)), made = b && fs.existsSync(b.img) && fs.existsSync(b.loop);
  const bubble = pick({ img: rel(en.ring) || (made ? b.img : null), loop: made ? b.loop : null }, ['img', 'loop']);
  groups.push({ order: has(en.order) ? +en.order : 999, title: { en: en.title || '', ge: ka.title || null }, label: { en: en.label || en.title || '', ge: ka.label || null }, categories: catNames(en.categories), bubble, items });
}
groups.sort((a, b) => a.order - b.order);
write('data/shots.json', { groups: groups.map(({ order, ...g }) => g) });

// ---------------------------------------------------------------- profile + contact
const overlay = key => {
  const f = `content/pages/${key}.json`; if (!fs.existsSync(f)) return null;
  const { en = {}, ka = {} } = read(f);
  return {
    lead: { en: en.lead || '', ge: ka.lead || null }, meta: { en: en.meta || '', ge: ka.meta || null },
    links: (en.links || []).map((l, k) => ({ label: { en: l.label, ge: ka.links?.[k]?.label || null }, href: { en: rel(l.href), ge: rel(ka.links?.[k]?.href || l.href) } })),
    ...(en.form ? { form: Object.fromEntries(Object.keys(en.form).map(k => [k, { en: en.form[k] || '', ge: ka.form?.[k] || null }])) } : {}),
  };
};
write('data/profile.json', { profile: overlay('profile'), contact: overlay('contact') });

// ---------------------------------------------------------------- search texts of the site's own pages (home, blog list, Profile, Contact)
{
  const f = 'content/pages/seo.json', { en = {}, ka = {} } = fs.existsSync(f) ? read(f) : {};
  const both = k => ({ en: seo(en[k]) || { title: '', description: '' }, ge: seo(ka[k]) || null });
  write('data/site.json', { pages: { home: both('home'), blog: both('blog'), about: both('about'), contact: both('contact') } });
}

console.log(`built: ${projects.length} projects (${projects.filter(p => p.featured).length} on the strip), ${stories.length} blog posts, ${groups.length} shot groups (${groups.reduce((n, g) => n + g.items.length, 0)} clips), profile + contact`);
