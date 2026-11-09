// One-time migration of the content files into the admin (Sveltia CMS) format: one JSON file per entry with the two locales as top-level keys,
// "en" (default) and "ka" (Georgian), and media paths written as site-absolute ("/assets/...") so the admin can preview them.
//   content/projects/<slug>/project.json   { en: {...all fields}, ka: {title, blurb, sections, seo} }
//   content/blog/<slug>/post.json           { en: {title, date, cover, categories, excerpt, body (markdown), seo}, ka: {...} }
//   content/shots/<group>.json              { en: {title, label, order, ring, items:[{title, webm, mp4, sound}]}, ka: {title, label, items:[...]} }
//   content/pages/profile.json, contact.json { en: {lead, meta, links:[{label, href}]}, ka: {...} }
// usage: node tools/migrate-to-cms.mjs   (from the newsite folder; refuses to run twice)
import fs from 'node:fs';
import path from 'node:path';

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };
const abs = p => (p && !/^(https?:|mailto:|tel:|\/)/.test(p) ? '/' + p : p);   // assets/x -> /assets/x
const ent = s => (s || '').replace(/&#8211;|&#8212;/g, '-').replace(/&#8216;|&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&hellip;/g, '...').replace(/–|—/g, '-');
const clean = o => JSON.parse(JSON.stringify(o, (k, v) => (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) ? undefined : v)));

if (fs.existsSync('content/blog')) { console.error('already migrated (content/blog exists)'); process.exit(1); }

// ---------------------------------------------------------------- projects
for (const slug of fs.readdirSync('content/projects')) {
  const f = `content/projects/${slug}/project.json`; if (!fs.existsSync(f)) continue;
  const p = read(f);
  const en = {
    title: p.title.en, featured: !!p.featured, order: p.order, year: p.year, client: p.client, cats: p.cats, link: p.link,
    blurb: p.blurb.en, sections: (p.sections.en || []).map(s => ({ h: s.h || '', t: s.t })),
    cover: abs(p.cover), gallery: (p.gallery || []).map(abs),
    home: p.home ? { img: abs(p.home.img), video: abs(p.home.video), webm: abs(p.home.webm) } : undefined,
    seo: { title: p.seo?.en?.title, description: p.seo?.en?.description, image: p.seo?.en?.image },
  };
  const ka = { title: p.title.ge, blurb: p.blurb.ge, sections: (p.sections.ge || []).map(s => ({ h: s.h || '', t: s.t })), seo: { title: p.seo?.ge?.title, description: p.seo?.ge?.description } };
  write(f, clean({ en, ka, _wp: p.wp }));
  console.log('project', slug);
}

// ---------------------------------------------------------------- blog: HTML bodies -> Markdown
const md = html => ent(html
  .replace(/\r/g, '')
  .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/g, '\n## $1\n').replace(/<h3[^>]*>([\s\S]*?)<\/h3>/g, '\n### $1\n').replace(/<h4[^>]*>([\s\S]*?)<\/h4>/g, '\n#### $1\n')
  .replace(/<li[^>]*>([\s\S]*?)<\/li>/g, '- $1\n').replace(/<\/?(ul|ol)[^>]*>/g, '\n')
  .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/g, (m, t) => '\n> ' + t.replace(/<[^>]+>/g, '').trim() + '\n')
  .replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, '**$2**').replace(/<(em|i)>([\s\S]*?)<\/\1>/g, '*$2*')
  .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '[$2]($1)')
  .replace(/<br\s*\/?>/g, '  \n').replace(/<p[^>]*>([\s\S]*?)<\/p>/g, '\n$1\n').replace(/<[^>]+>/g, '')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()) + '\n';
for (const slug of fs.readdirSync('content/stories')) {
  const dir = `content/stories/${slug}`; if (!fs.existsSync(`${dir}/story.json`)) continue;
  const s = read(`${dir}/story.json`);
  const bodyEn = fs.readFileSync(`${dir}/body.en.html`, 'utf8'), bodyKa = fs.existsSync(`${dir}/body.ge.html`) ? fs.readFileSync(`${dir}/body.ge.html`, 'utf8') : null;
  const en = { title: s.title.en, date: s.date, cover: abs(s.cover), categories: s.categories, tags: s.tags, excerpt: s.excerpt.en, body: md(bodyEn), seo: { title: s.seo?.en?.title, description: s.seo?.en?.description, image: s.seo?.en?.image } };
  const ka = bodyKa ? { title: s.title.ge, excerpt: s.excerpt.ge, body: md(bodyKa), seo: { title: s.seo?.ge?.title, description: s.seo?.ge?.description } } : undefined;
  write(`content/blog/${slug}/post.json`, clean({ en, ka, _wp: s.wp }));
  console.log('post', slug, ka ? '(+ka)' : '');
}

// ---------------------------------------------------------------- shots: one entry per group
const groups = read('data/shots.json').groups;
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
fs.rmSync('content/shots', { recursive: true, force: true });
groups.forEach((g, gi) => {
  const items = g.items.map(it => ({ title: it.title.en, webm: abs(it.video.webm), mp4: abs(it.video.mp4), sound: !!it.sound }));
  const en = { title: g.title.en, label: g.label.en, order: gi, ring: abs(g.ring), items };
  const ka = { title: g.title.ge, label: g.label.ge, items: g.items.map((it, k) => ({ ...items[k], title: it.title.ge || it.title.en })) };
  write(`content/shots/${slugify(g.title.en)}.json`, clean({ en, ka }));
  console.log('shots', slugify(g.title.en), items.length);
});

// ---------------------------------------------------------------- profile + contact overlays
const ov = read('data/profile.json');
fs.rmSync('content/pages', { recursive: true, force: true });
for (const key of ['profile', 'contact']) {
  const o = ov[key], hrefOf = (l, lang) => (typeof l.href === 'object' ? l.href[lang] : l.href);
  write(`content/pages/${key}.json`, clean({
    en: { lead: o.lead.en, meta: o.meta.en, links: o.links.map(l => ({ label: l.label.en, href: abs(hrefOf(l, 'en')) })) },
    ka: { lead: o.lead.ge, meta: o.meta.ge, links: o.links.map(l => ({ label: l.label.ge, href: abs(hrefOf(l, 'ge')) })) },
  }));
  console.log('page', key);
}
fs.rmSync('content/stories', { recursive: true, force: true });
console.log('done');
