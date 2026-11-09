// build-content.mjs - turns the raw WordPress export (content/wp-export) into the site's own content files:
//   content/projects/<slug>/project.json   both languages, SEO, media paths (order and curated EN texts come from data/projects.json)
//   content/stories/<slug>/story.json + body.en.html + body.ge.html
//   content/shots/shots.json               the bubble groups with ring images and videos
//   content/pages/about.json, contact.json both languages as ordered text blocks + cleaned HTML
//   data/projects.json                     regenerated for the app (EN first, GE under i18n.ge)
// Media the site needs is copied from the export into assets/ (videos into assets/video/, which git ignores).
// usage: node tools/build-content.mjs      (run from the newsite folder; idempotent)
import fs from 'node:fs';
import path from 'node:path';

const X = 'content/wp-export';
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n'); };
const ent = s => (s || '').replace(/&#8211;/g, '-').replace(/&#8212;/g, '-').replace(/&#8216;|&#8217;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&hellip;/g, '...').replace(/–|—/g, '-');
const text = html => ent(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const localOf = u => path.join(X, 'media', u.replace(/^https?:\/\/bitz\.ge\/(ge\/)?wp-content\/uploads\//, m => (m.includes('/ge/') ? 'ge/' : '')).split('?')[0]);
function copyMedia(url, destDir, name) {            // copies one export file into assets/, returns the site-relative path (or null)
  if (!url) return null;
  const src = localOf(url); if (!fs.existsSync(src)) { console.log('  missing media', url); return null; }
  const file = path.join(destDir, name || path.basename(src));
  fs.mkdirSync(destDir, { recursive: true }); if (!fs.existsSync(file)) fs.copyFileSync(src, file);
  return file.replace(/\\/g, '/');
}
// ordered blocks of a Gutenberg page: [tag, text, href]
const blocks = html => [...html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').matchAll(/<(h[1-6]|p|li|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)]
  .map(m => ({ tag: m[1], text: text(m[3]), href: (m[2].match(/href="([^"]+)"/) || [])[1] })).filter(b => b.text);
// a project page: lead paragraph + (heading, paragraphs) sections, without the closing contact call-to-action
function projectText(html) {
  const b = blocks(html).filter(x => x.tag !== 'a' && x.tag !== 'li');
  const cta = b.findIndex((x, i) => i > 2 && /კონტაქტი|მომწერე|Got questions|Drop me a line|Contact/i.test(x.text) && (x.tag === 'p' || x.tag === 'h3') && i >= b.length - 2);
  const body = cta > 0 ? b.slice(0, cta) : b;
  let lead = '', sections = [], cur = null;
  for (let i = 0; i < body.length; i++) {
    const x = body[i];
    if (/^h[1-6]$/.test(x.tag) || (x.tag === 'p' && x.text.length < 60 && body[i + 1] && body[i + 1].tag !== 'p')) {   // short lone paragraphs act as headings in this theme
      if (i === 0 && /about|შესახებ/i.test(x.text)) { cur = { h: null, t: [] }; continue; }
      cur = { h: x.text, t: [] }; sections.push(cur); continue;
    }
    if (!cur) { lead = lead ? lead + ' ' + x.text : x.text; continue; }
    if (cur.h === null) { lead = lead ? lead + ' ' + x.text : x.text; continue; }
    cur.t.push(x.text);
  }
  return { lead, sections: sections.filter(s => s.t.length).map(s => ({ h: s.h, t: s.t.join(' ') })) };
}
const seoOf = item => ({ title: ent(item?.yoast_head_json?.title || ''), description: ent(item?.yoast_head_json?.description || ''), image: item?.yoast_head_json?.og_image?.[0]?.url || null });

// ---------------------------------------------------------------- projects
const cur = read('data/projects.json');
const enP = read(`${X}/en/portfolio.json`), geP = read(`${X}/ge/portfolio.json`);
const projectsOut = [];
cur.forEach((p, i) => {
  const en = enP.find(x => x.slug === p.slug), ge = geP.find(x => x.slug === p.slug);
  const geT = ge ? projectText(ge.content.rendered) : null;
  const pj = {
    slug: p.slug, order: i, featured: !!p.featured, year: p.year, client: p.client, cats: p.cats, link: p.link || null,
    title: { en: p.title, ge: ge ? ent(ge.title.rendered) : null },
    blurb: { en: p.blurb, ge: geT?.lead || null },
    sections: { en: p.sections, ge: geT?.sections || null },
    cover: p.cover, gallery: p.gallery, home: p.home || null,
    seo: { en: seoOf(en), ge: ge ? seoOf(ge) : null },
    wp: { en: en ? { id: en.id, link: en.link, modified: en.modified } : null, ge: ge ? { id: ge.id, link: ge.link, modified: ge.modified } : null },
  };
  write(`content/projects/${p.slug}/project.json`, pj);
  projectsOut.push({ ...p, seo: pj.seo.en, i18n: { ge: { title: pj.title.ge, blurb: pj.blurb.ge, sections: pj.sections.ge, seo: pj.seo.ge } } });
  console.log(`project ${p.slug}: ge title "${pj.title.ge}" lead ${geT?.lead?.length || 0} chars, ${geT?.sections?.length || 0} ge sections`);
});
write('data/projects.json', projectsOut);

// ---------------------------------------------------------------- stories (blog posts)
const enS = read(`${X}/en/posts.json`), geS = read(`${X}/ge/posts.json`);
const feat = p => p._embedded?.['wp:featuredmedia']?.[0]?.source_url || null;
const key = u => (u || '').split('/').pop().replace(/-clean|-fixed/g, '').replace(/\.\w+$/, '');
const cleanHtml = html => html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/\s(class|id|style|data-[a-z-]+|aria-[a-z-]+)="[^"]*"/g, '')
  .replace(/<!--[\s\S]*?-->/g, '').replace(/<(div|span|figure|figcaption)[^>]*>/g, '').replace(/<\/(div|span|figure|figcaption)>/g, '').replace(/\n{3,}/g, '\n\n').trim();
const storyIndex = [];
for (const en of enS) {
  const ge = geS.find(g => key(feat(g)) === key(feat(en))) || null;
  const dir = `content/stories/${en.slug}`;
  const cover = copyMedia(feat(en), 'assets/stories', `${en.slug}${path.extname(feat(en) || '.jpg')}`);
  const cats = read(`${X}/en/categories.json`), tags = read(`${X}/en/tags.json`);
  const sj = {
    slug: en.slug, date: en.date, modified: en.modified,
    title: { en: ent(en.title.rendered), ge: ge ? ent(ge.title.rendered) : null },
    excerpt: { en: text(en.excerpt.rendered), ge: ge ? text(ge.excerpt.rendered) : null },
    cover, categories: en.categories.map(id => cats.find(c => c.id === id)?.name).filter(Boolean), tags: en.tags.map(id => tags.find(t => t.id === id)?.name).filter(Boolean),
    seo: { en: seoOf(en), ge: ge ? seoOf(ge) : null },
    wp: { en: { id: en.id, link: en.link }, ge: ge ? { id: ge.id, link: ge.link, slug: ge.slug } : null },
  };
  write(`${dir}/story.json`, sj);
  write(`${dir}/body.en.html`, cleanHtml(en.content.rendered));
  if (ge) write(`${dir}/body.ge.html`, cleanHtml(ge.content.rendered));
  storyIndex.push({ slug: sj.slug, date: sj.date, title: sj.title, excerpt: sj.excerpt, cover, categories: sj.categories, hasGe: !!ge });
  console.log(`story ${en.slug}: ge ${ge ? ge.slug : '-'}`);
}
write('data/stories.json', storyIndex);

// ---------------------------------------------------------------- shots (bubbles): merge EN + GE rows by video base name
const SL = read(`${X}/shots-live.json`);
const base = u => (u || '').split('/').pop().replace(/\.\w+$/, '').replace(/_\d+$/, '').toLowerCase();
const groups = SL.en.map((g, gi) => {
  const geG = SL.ge[gi];
  const ring = copyMedia(g.ring, 'assets/shots');
  const items = g.items.map(it => {
    const b = base(it.sources?.[0]?.src);
    const geIt = geG?.items.find(x => base(x.sources?.[0]?.src) === b);
    const srcs = [...(it.sources || []), ...(geIt?.sources || [])];
    const uniq = [...new Map(srcs.map(s => [s.src, s])).values()];
    const webm = uniq.find(s => /webm/.test(s.type) || /\.webm$/.test(s.src)), mp4 = uniq.find(s => /mp4/.test(s.type) || /\.mp4$/.test(s.src));
    const vid = {};
    if (webm) vid.webm = copyMedia(webm.src, 'assets/video/shots');
    if (mp4 && (!webm || fs.statSync(localOf(mp4.src)).size < 8e6)) vid.mp4 = copyMedia(mp4.src, 'assets/video/shots');   // skip the 13 MB mp4s when a webm exists
    return { id: b, title: it.title || b, sound: !!it.hasSound, wp: { en: it.postId, ge: geIt?.postId || null }, video: vid };
  });
  return { title: { en: g.title, ge: geG?.title || null }, label: { en: g.label, ge: geG?.label || null }, ring, items };
});
write('content/shots/shots.json', { groups });
write('data/shots.json', { groups });
console.log(`shots: ${groups.length} groups, ${groups.reduce((n, g) => n + g.items.length, 0)} items`);

// ---------------------------------------------------------------- pages: about + contact
for (const slug of ['about', 'contact']) {
  const out = { slug, title: {}, blocks: {}, images: {}, seo: {} };
  for (const lang of ['en', 'ge']) {
    const pg = read(`${X}/${lang}/pages.json`).find(x => x.slug === slug); if (!pg) continue;
    out.title[lang] = ent(pg.title.rendered);
    out.blocks[lang] = blocks(pg.content.rendered).map(b => (b.href ? { ...b, href: b.href.replace(/^https?:\/\/bitz\.ge\/wp-content\/uploads\//, '') } : b));
    out.images[lang] = [...pg.content.rendered.matchAll(/<img[^>]*src="([^"]+)"/g)].map(m => m[1].replace(/-\d+x\d+(\.\w+)$/, '$1')).filter((v, i, a) => a.indexOf(v) === i)
      .map(u => copyMedia(u, `assets/${slug}`)).filter(Boolean);
    out.seo[lang] = seoOf(pg);
    write(`content/pages/${slug}.${lang}.html`, cleanHtml(pg.content.rendered));
    for (const b of out.blocks[lang]) if (b.href && /\.pdf$/i.test(b.href)) copyMedia('https://bitz.ge/wp-content/uploads/' + b.href, 'assets/docs');
  }
  write(`content/pages/${slug}.json`, out);
  console.log(`page ${slug}: en ${out.blocks.en?.length || 0} blocks, ge ${out.blocks.ge?.length || 0} blocks, images ${out.images.en?.length || 0}`);
}
console.log('done');
