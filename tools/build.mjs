// build.mjs - turns the content files (edited in the admin at /admin, or by hand) into the data files the site reads:
//   content/projects/<slug>/project.json -> data/projects.json  (ordered by "order"; Georgian under i18n.ge)
//   content/blog/<slug>/post.json        -> data/stories.json   (newest first; Markdown body -> panel sections)
//   content/shots/*.json                 -> data/shots.json     (groups ordered by "order")
//   content/pages/profile.json, contact.json -> data/profile.json
// The content files keep the two locales as top-level keys: "en" (default) and "ka" (Georgian); the app calls Georgian "ge".
// The transforms live in admin/content.mjs, shared with the admin's preview, so a draft previews exactly as it will build.
// usage: node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { bubbleFor, firstClip } from './bubbles.mjs';
import { project, story, shotGroup, overlay, seo } from '../admin/content.mjs';

const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1) + '\n'); };

// ---------------------------------------------------------------- projects
const projects = [];
for (const slug of fs.existsSync('content/projects') ? fs.readdirSync('content/projects') : []) {
  const f = `content/projects/${slug}/project.json`; if (!fs.existsSync(f)) continue;
  const { en = {}, ka = {} } = read(f);
  projects.push(project(slug, en, ka));
}
projects.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
write('data/projects.json', projects.map(({ order, ...p }) => p));

// ---------------------------------------------------------------- blog
const stories = [];
for (const slug of fs.existsSync('content/blog') ? fs.readdirSync('content/blog') : []) {
  const f = `content/blog/${slug}/post.json`; if (!fs.existsSync(f)) continue;
  const { en = {}, ka } = read(f);
  stories.push(story(slug, en, ka));
}
stories.sort((a, b) => String(b.date).localeCompare(String(a.date)));
write('data/stories.json', stories);

// ---------------------------------------------------------------- shots
const groups = [];
for (const file of fs.existsSync('content/shots') ? fs.readdirSync('content/shots').filter(f => f.endsWith('.json')) : []) {
  const { en = {}, ka = {} } = read(`content/shots/${file}`);
  // bubble: the still + hover loop made from the first clip by tools/bubbles.mjs, when both files exist
  const b = bubbleFor(firstClip(en)), made = b && fs.existsSync(b.img) && fs.existsSync(b.loop) ? b : null;
  const g = shotGroup(en, ka, made);
  if (g) groups.push(g);
}
groups.sort((a, b) => a.order - b.order);
write('data/shots.json', { groups: groups.map(({ order, ...g }) => g) });

// ---------------------------------------------------------------- profile + contact
const page = key => { const f = `content/pages/${key}.json`; if (!fs.existsSync(f)) return null; const { en = {}, ka = {} } = read(f); return overlay(en, ka); };
write('data/profile.json', { profile: page('profile'), contact: page('contact') });

// ---------------------------------------------------------------- search texts of the site's own pages (home, blog list, Profile, Contact)
{
  const f = 'content/pages/seo.json', { en = {}, ka = {} } = fs.existsSync(f) ? read(f) : {};
  const both = k => ({ en: seo(en[k]) || { title: '', description: '' }, ge: seo(ka[k]) || null });
  write('data/site.json', { pages: { home: both('home'), blog: both('blog'), about: both('about'), contact: both('contact') } });
}

console.log(`built: ${projects.length} projects (${projects.filter(p => p.featured).length} on the strip), ${stories.length} blog posts, ${groups.length} shot groups (${groups.reduce((n, g) => n + g.items.length, 0)} clips), profile + contact`);
