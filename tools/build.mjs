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
const seo = s => (s ? { title: s.title || '', description: s.description || '', image: s.image || null } : null);

// ---------------------------------------------------------------- projects
const projects = [];
for (const slug of fs.existsSync('content/projects') ? fs.readdirSync('content/projects') : []) {
  const f = `content/projects/${slug}/project.json`; if (!fs.existsSync(f)) continue;
  const { en = {}, ka = {} } = read(f);
  const sec = list => (list || []).filter(s => has(s.t)).map(s => ({ h: s.h || '', t: s.t }));
  const kaSec = sec(ka.sections);
  projects.push({
    slug, order: has(en.order) ? +en.order : 999, title: en.title || slug, featured: en.featured !== false, year: en.year || '', client: en.client || '',
    cats: en.cats || [], link: en.link || null, blurb: en.blurb || '', cover: rel(en.cover), gallery: (en.gallery || []).map(rel), sections: sec(en.sections),
    home: en.home && (en.home.img || en.home.video) ? pick({ img: rel(en.home.img), video: rel(en.home.video), webm: rel(en.home.webm) }, ['img', 'video', 'webm']) : null,
    seo: seo(en.seo),
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
    cover: rel(en.cover), categories: en.categories || [], hasGe: kaOk, sections: { en: sections(en.body), ge: kaOk ? sections(ka.body) : null },
    seo: { en: seo(en.seo), ge: kaOk ? seo(ka.seo) : null },
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
  groups.push({ order: has(en.order) ? +en.order : 999, title: { en: en.title || '', ge: ka.title || null }, label: { en: en.label || en.title || '', ge: ka.label || null }, bubble, items });
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
  };
};
write('data/profile.json', { profile: overlay('profile'), contact: overlay('contact') });

console.log(`built: ${projects.length} projects (${projects.filter(p => p.featured).length} on the strip), ${stories.length} blog posts, ${groups.length} shot groups (${groups.reduce((n, g) => n + g.items.length, 0)} clips), profile + contact`);
