// pages.mjs - writes a real HTML page for every address of the site, in both languages, into a staged build folder.
// Each page is the app's index.html with its own <head> (title, description, canonical, hreflang, Open Graph, Twitter, JSON-LD)
// and a readable text version of its content in <main id="doc"> (for search engines, link previews, screen readers and no-JS).
// The same app boots on every page and opens what the address names. Addresses match the WordPress site they replace:
//   /  /ge/  /portfolio/<slug>/  /ge/portfolio/<slug>/  /blog/yyyy/mm/dd/<slug>/  /ge/yyyy/mm/dd/<ka-slug>/
//   /stories/  /ge/stories/  /about/  /ge/about/  /contact/  /ge/contact/
// Also: sitemap.xml (with hreflang pairs and images), robots.txt, 404.html and an .htaccess that serves it.
// usage: node tools/pages.mjs <stagedDir>   (run by tools/stage.js after the asset stamps)
import fs from 'node:fs';
import path from 'node:path';
import { ORIGIN, BASE, INDEX } from './site.mjs';

const OUT = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(path.join(OUT, 'index.html'))) { console.error('usage: node tools/pages.mjs <stagedDir with index.html>'); process.exit(1); }
const J = f => JSON.parse(fs.readFileSync(path.join(OUT, 'data', f), 'utf8'));
const projects = J('projects.json'), stories = J('stories.json'), overlays = J('profile.json'), site = J('site.json');
const TEMPLATE = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = p => (/^https?:/.test(p) ? p : ORIGIN + BASE + String(p || '').replace(/^\/+/, ''));
const short = t => String(t || '').replace(/\s*\|\s*[^|]*$/, '');                      // "Title | Bitz" -> "Title"
const pick = (o, L) => (o && typeof o === 'object' && !Array.isArray(o) ? (L === 'ka' ? o.ge || o.en : o.en) : o);
const W = { en: { work: 'Featured work', all: 'All projects', blog: 'Blog', profile: 'Profile', contact: 'Contact', client: 'Client', year: 'Year', live: 'View the live project', more: 'More projects', lang: 'ქართული', home: 'Home', posts: 'Latest posts' },
            ka: { work: 'რჩეული ნამუშევრები', all: 'ყველა პროექტი', blog: 'ბლოგი', profile: 'პროფილი', contact: 'კონტაქტი', client: 'კლიენტი', year: 'წელი', live: 'პროექტის ნახვა', more: 'სხვა პროექტები', lang: 'English', home: 'მთავარი', posts: 'ბოლო ჩანაწერები' } };
const pre = L => (L === 'ka' ? 'ge/' : '');
const kaOf = { project: p => p.url.ge, post: s => s.url.ge };

// ---------------------------------------------------------------- shared bits
const people = (() => {
  const links = (overlays.profile?.links || []).concat(overlays.contact?.links || []).map(l => l.href?.en).filter(h => /^https?:/.test(h || ''));
  return { '@type': 'Person', '@id': `${ORIGIN}/#luka`, name: 'Luka Gabidzashvili', alternateName: 'Bitz', jobTitle: 'Full-stack designer', url: abs(''),
    address: { '@type': 'PostalAddress', addressLocality: 'Tbilisi', addressCountry: 'GE' }, sameAs: [...new Set(links)] };
})();
const cover = p => (p.home?.img || p.cover || 'assets/img/logo.svg');

function head(pg) {
  const alt = pg.alt, can = abs(pg.path);
  const L = pg.lang, ogl = L === 'ka' ? 'ka_GE' : 'en_US';
  return [
    `<title>${esc(pg.title)}</title>`,
    `<meta name="description" content="${esc(pg.description)}">`,
    INDEX ? '' : '<meta name="robots" content="noindex, nofollow">',
    `<link rel="canonical" href="${esc(can)}">`,
    alt.en != null ? `<link rel="alternate" hreflang="en" href="${esc(abs(alt.en))}">` : '',
    alt.ka != null ? `<link rel="alternate" hreflang="ka" href="${esc(abs(alt.ka))}">` : '',
    alt.en != null ? `<link rel="alternate" hreflang="x-default" href="${esc(abs(alt.en))}">` : '',
    `<meta property="og:type" content="${pg.type}">`, `<meta property="og:site_name" content="bitz">`,
    `<meta property="og:title" content="${esc(pg.title)}">`, `<meta property="og:description" content="${esc(pg.description)}">`,
    `<meta property="og:url" content="${esc(can)}">`, `<meta property="og:image" content="${esc(abs(pg.image))}">`,
    `<meta property="og:locale" content="${ogl}">`, alt[L === 'ka' ? 'en' : 'ka'] != null ? `<meta property="og:locale:alternate" content="${L === 'ka' ? 'en_US' : 'ka_GE'}">` : '',
    pg.published ? `<meta property="article:published_time" content="${esc(pg.published)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`, `<meta name="twitter:title" content="${esc(pg.title)}">`,
    `<meta name="twitter:description" content="${esc(pg.description)}">`, `<meta name="twitter:image" content="${esc(abs(pg.image))}">`,
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': pg.ld }).replace(/</g, '\\u003c')}</script>`,
  ].filter(Boolean).join('\n');
}
// the readable version: plain semantic HTML, no images (they would download in the background; images reach Google via the sitemap and JSON-LD)
const a = (href, text) => `<a href="${esc(href || './')}" tabindex="-1">${esc(text)}</a>`;   // "" would mean "this page" under <base>: the home is "./"
function siteNav(L, pg) {
  const w = W[L], other = pg.alt[L === 'ka' ? 'en' : 'ka'];
  return `<nav aria-label="bitz"><ul><li>${a(pre(L), w.home)}</li><li>${a(pre(L) + 'stories/', w.blog)}</li><li>${a(pre(L) + 'about/', w.profile)}</li><li>${a(pre(L) + 'contact/', w.contact)}</li>`
    + (other != null ? `<li lang="${L === 'ka' ? 'en' : 'ka'}">${a(other, w.lang)}</li>` : '') + '</ul></nav>';
}
// a section's text is one string (projects) or a list of paragraphs (blog posts; "• " marks a list item)
const paras = list => (list || []).map(s => (s.h ? `<h2>${esc(s.h)}</h2>` : '')
  + (Array.isArray(s.t) ? s.t : String(s.t || '').split(/\n+/)).filter(Boolean).map(t => `<p>${esc(t)}</p>`).join('')).join('');
const P = (p, L) => { const g = L === 'ka' ? p.i18n?.ge : null; return { title: g?.title || p.title, blurb: g?.blurb || p.blurb, sections: g?.sections?.length ? g.sections : p.sections, seo: (L === 'ka' ? g?.seo : null) || p.seo || {} }; };
const Sx = (s, L) => { const k = L === 'ka' && s.hasGe ? 'ge' : 'en'; return { title: s.title[k], excerpt: s.excerpt[k], sections: s.sections[k] || s.sections.en, seo: s.seo?.[k] || s.seo?.en || {} }; };
const sitePage = (key, L) => (L === 'ka' ? site.pages[key].ge : null) || site.pages[key].en;

// ---------------------------------------------------------------- the pages
const pages = [];
const featured = projects.filter(p => p.featured);
for (const L of ['en', 'ka']) {
  const w = W[L], sp = sitePage('home', L);
  // home
  pages.push({ path: pre(L), lang: L, alt: { en: '', ka: 'ge/' }, type: 'website', title: sp.title, description: sp.description, image: cover(featured[0] || projects[0]),
    images: featured.map(cover),
    ld: [people, { '@type': 'WebSite', '@id': `${ORIGIN}/#site`, url: abs(pre(L)), name: 'bitz', inLanguage: L, publisher: { '@id': people['@id'] } }],
    doc: `<h1>${esc(short(sp.title))}</h1><p>${esc(pick(overlays.profile?.lead, L))}</p>`
      + `<section><h2>${w.work}</h2><ul>${featured.map(p => `<li>${a(p.url[L === 'ka' ? 'ge' : 'en'] || p.url.en, P(p, L).title)} - ${esc(P(p, L).blurb)}</li>`).join('')}</ul></section>`
      + `<section><h2>${w.all}</h2><ul>${projects.filter(p => !p.featured).map(p => `<li>${a(p.url[L === 'ka' ? 'ge' : 'en'] || p.url.en, P(p, L).title)}</li>`).join('')}</ul></section>`
      + `<section><h2>${w.posts}</h2><ul>${stories.filter(s => L === 'en' || s.url.ge).map(s => `<li>${a(L === 'ka' ? s.url.ge : s.url.en, Sx(s, L).title)}</li>`).join('')}</ul></section>` });
  // blog list
  const bp = sitePage('blog', L), list = stories.filter(s => L === 'en' || s.url.ge);
  pages.push({ path: pre(L) + 'stories/', lang: L, alt: { en: 'stories/', ka: 'ge/stories/' }, type: 'website', title: bp.title, description: bp.description, image: list[0] ? list[0].cover : cover(projects[0]),
    images: list.map(s => s.cover).filter(Boolean),
    ld: [people, { '@type': 'Blog', url: abs(pre(L) + 'stories/'), name: short(bp.title), inLanguage: L, author: { '@id': people['@id'] },
      blogPost: list.map(s => ({ '@type': 'BlogPosting', headline: Sx(s, L).title, url: abs(L === 'ka' ? s.url.ge : s.url.en), datePublished: s.date })) }],
    doc: `<h1>${esc(short(bp.title))}</h1><p>${esc(bp.description)}</p><ul>${list.map(s => `<li><article><h2>${a(L === 'ka' ? s.url.ge : s.url.en, Sx(s, L).title)}</h2><time datetime="${esc(s.date)}">${esc(s.date.slice(0, 10))}</time><p>${esc(Sx(s, L).excerpt)}</p></article></li>`).join('')}</ul>` });
  // profile + contact
  for (const [key, ov] of [['about', 'profile'], ['contact', 'contact']]) {
    const o = overlays[ov], t = sitePage(key, L);
    if (!o) continue;
    pages.push({ path: pre(L) + key + '/', lang: L, alt: { en: key + '/', ka: 'ge/' + key + '/' }, type: key === 'about' ? 'profile' : 'website', title: t.title, description: t.description, image: cover(featured[0] || projects[0]),
      ld: [people, { '@type': key === 'about' ? 'AboutPage' : 'ContactPage', url: abs(pre(L) + key + '/'), name: short(t.title), inLanguage: L, about: { '@id': people['@id'] } }],
      doc: `<h1>${esc(short(t.title))}</h1><p>${esc(pick(o.lead, L))}</p>${pick(o.meta, L) ? `<p>${esc(pick(o.meta, L))}</p>` : ''}<ul>${o.links.map(l => `<li>${a(pick(l.href, L), pick(l.label, L))}</li>`).join('')}</ul>` });
  }
  // projects
  for (const p of projects) {
    const u = L === 'ka' ? p.url.ge : p.url.en; if (!u) continue;
    const t = P(p, L), title = t.seo.title || `${t.title} | bitz`, desc = t.seo.description || t.blurb;
    const meta = [p.client && `<li>${w.client}: ${esc(p.client)}</li>`, p.year && `<li>${w.year}: ${esc(p.year)}</li>`, p.cats?.length && `<li>${esc(p.cats.join(', '))}</li>`].filter(Boolean).join('');
    pages.push({ path: u, lang: L, alt: { en: p.url.en, ka: p.url.ge }, type: 'article', title, description: desc, image: cover(p), images: [p.cover, ...(p.gallery || [])].filter(Boolean),
      ld: [people, { '@type': 'CreativeWork', '@id': abs(u) + '#work', url: abs(u), name: t.title, headline: t.title, description: desc, inLanguage: L,
        image: [p.cover, ...(p.gallery || [])].filter(Boolean).slice(0, 12).map(abs), dateCreated: p.year || undefined, keywords: (p.cats || []).join(', ') || undefined,
        creator: { '@id': people['@id'] }, ...(p.client ? { sourceOrganization: { '@type': 'Organization', name: p.client } } : {}), ...(p.link ? { sameAs: p.link } : {}) },
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: w.home, item: abs(pre(L)) }, { '@type': 'ListItem', position: 2, name: t.title, item: abs(u) }] }],
      doc: `<article><h1>${esc(t.title)}</h1><p>${esc(t.blurb)}</p>${meta ? `<ul>${meta}</ul>` : ''}${paras(t.sections)}${p.link ? `<p>${a(p.link, w.live)}</p>` : ''}</article>`
        + `<nav aria-label="${w.more}"><h2>${w.more}</h2><ul>${projects.filter(x => x !== p && (L === 'en' || x.url.ge)).map(x => `<li>${a(L === 'ka' ? x.url.ge : x.url.en, P(x, L).title)}</li>`).join('')}</ul></nav>` });
  }
  // blog posts
  for (const s of stories) {
    const u = L === 'ka' ? s.url.ge : s.url.en; if (!u) continue;
    const t = Sx(s, L), title = t.seo.title || `${t.title} | bitz`, desc = t.seo.description || t.excerpt;
    pages.push({ path: u, lang: L, alt: { en: s.url.en, ka: s.url.ge }, type: 'article', title, description: desc, image: s.cover || cover(projects[0]), published: s.date, images: [s.cover].filter(Boolean),
      ld: [people, { '@type': 'BlogPosting', '@id': abs(u) + '#post', url: abs(u), mainEntityOfPage: abs(u), headline: t.title, description: desc, inLanguage: L,
        image: s.cover ? [abs(s.cover)] : undefined, datePublished: s.date, author: { '@id': people['@id'] }, publisher: { '@id': people['@id'] }, keywords: (s.categories || []).join(', ') || undefined },
        { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: w.blog, item: abs(pre(L) + 'stories/') }, { '@type': 'ListItem', position: 2, name: t.title, item: abs(u) }] }],
      doc: `<article><h1>${esc(t.title)}</h1><time datetime="${esc(s.date)}">${esc(s.date.slice(0, 10))}</time><p>${esc(t.excerpt)}</p>${paras(t.sections)}</article><p>${a(pre(L) + 'stories/', w.blog)}</p>` });
  }
}
// the Georgian home / list / profile pages always exist; a page whose Georgian twin is missing (a post without a translation) has alt.ka = null

// ---------------------------------------------------------------- write
function render(pg) {
  const L = pg.lang;
  let h = TEMPLATE
    .replace(/<html lang="[^"]*">/, `<html lang="${L}">`)
    .replace(/<base href="[^"]*">/, `<base href="${BASE}">`)
    .replace(/<!--seo-->[\s\S]*?<!--\/seo-->/, `<!--seo-->\n${head(pg)}\n<!--/seo-->`)
    .replace(/<!--doc-->[\s\S]*?<!--\/doc-->/, `<!--doc-->${siteNav(L, pg)}${pg.doc}<!--/doc-->`)
    .replace(/(id="home"[^>]*href=")[^"]*"|(href=")[^"]*("[^>]*id="home")/, (m, a1, b1, b2) => (a1 ? `${a1}${pre(L) || './'}"` : `${b1}${pre(L) || './'}${b2}`))
    .replace(/href="[^"]*"(\s+data-ui="profile")/, `href="${pre(L)}about/"$1`)
    .replace(/href="[^"]*"(\s+data-ui="contact")/, `href="${pre(L)}contact/"$1`);
  return h;
}
let n = 0;
const seen = new Set();
for (const pg of pages) {
  if (seen.has(pg.path)) throw new Error(`two pages want the address /${pg.path}`);
  seen.add(pg.path);
  const dir = path.join(OUT, pg.path); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), render(pg)); n++;
}
// not found: the home page's app with a "not found" text; Apache serves it with a 404 status (see .htaccess)
const nf = { ...pages[0], path: '404.html', title: 'Page not found | bitz', description: 'This page does not exist. The work, the blog and the profile are one click away.',
  doc: `<h1>Page not found</h1><p>This address does not exist on bitz.ge.</p>` };
fs.writeFileSync(path.join(OUT, '404.html'), render(nf).replace(/<link rel="canonical"[^>]*>\n?/, '').replace(/<link rel="alternate"[^>]*>\n?/g, '').replace(/<meta name="robots"[^>]*>\n?/, '').replace('<!--seo-->', '<!--seo-->\n<meta name="robots" content="noindex">'));
fs.writeFileSync(path.join(OUT, '.htaccess'), [
  '# generated by tools/pages.mjs - the static bitz site',
  '# no rewriting here: every address is a real folder with an index.html (this also keeps WordPress rules of a parent folder out)',
  'RewriteEngine On',
  'DirectoryIndex index.html',
  `ErrorDocument 404 ${BASE}404.html`,
  '<IfModule mod_headers.c>',
  '  <FilesMatch "\\.html$">',
  '    Header set Cache-Control "no-cache"',
  '  </FilesMatch>',
  '</IfModule>', ''].join('\n'));
// sitemap with language pairs and images
const urlEntry = pg => {
  const alts = ['en', 'ka'].filter(k => pg.alt[k] != null).map(k => `    <xhtml:link rel="alternate" hreflang="${k}" href="${esc(abs(pg.alt[k]))}"/>`);
  const imgs = [...new Set(pg.images || [])].slice(0, 20).map(i => `    <image:image><image:loc>${esc(abs(i))}</image:loc></image:image>`);
  return ['  <url>', `    <loc>${esc(abs(pg.path))}</loc>`, ...(pg.published ? [`    <lastmod>${esc(pg.published.slice(0, 10))}</lastmod>`] : []), ...alts, ...imgs, '  </url>'].join('\n');
};
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), ['<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ...pages.map(urlEntry), '</urlset>', ''].join('\n'));
fs.writeFileSync(path.join(OUT, 'robots.txt'), INDEX ? `User-agent: *\nAllow: /\nDisallow: ${BASE}admin/\n\nSitemap: ${abs('sitemap.xml')}\n` : 'User-agent: *\nDisallow: /\n');
console.log(`pages: ${n} addresses (${pages.filter(p => p.lang === 'en').length} English, ${pages.filter(p => p.lang === 'ka').length} Georgian) + 404, sitemap.xml, robots.txt, .htaccess; base ${BASE}${INDEX ? '' : ' (noindex preview)'}`);
