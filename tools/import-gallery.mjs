// One-time import of the project galleries from the live WordPress site (images and videos, in page order).
// Input: a JSON of ordered media per slug (made from the REST content), output: assets/img/<slug>-N.webp, assets/video/projects/<slug>-<name>.<ext>
// and the gallery list written into content/projects/<slug>/project.json (en). usage: node tools/import-gallery.mjs <wp-media.json>
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const req = createRequire(import.meta.url); let sharp; try { sharp = req('sharp'); } catch { sharp = req('C:/Users/luka_/bitz-agents/tools/node_modules/sharp'); }
const media = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const UA = { 'user-agent': 'Mozilla/5.0 (bitz-site import)' };
const get = async u => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(r.status + ' ' + u); return Buffer.from(await r.arrayBuffer()); };
fs.mkdirSync('assets/video/projects', { recursive: true });
for (const [slug, list] of Object.entries(media)) {
  const file = `content/projects/${slug}/project.json`; if (!fs.existsSync(file)) { console.log('skip', slug); continue; }
  for (const f of fs.readdirSync('assets/img')) if (new RegExp(`^${slug}-\d+\.webp$`).test(f)) fs.unlinkSync(path.join('assets/img', f));   // regenerate the numbering
  const gallery = []; let n = 0;
  for (const m of list) {
    if (m.t === 'img') {
      let buf; try { buf = await get(m.u); } catch { try { buf = await get(m.orig || m.u); } catch (e) { console.log('  FAIL', e.message); continue; } }
      n++; const out = `assets/img/${slug}-${n}.webp`;
      const img = sharp(buf).rotate(); const meta = await img.metadata();
      await img.resize({ width: Math.min(1600, meta.width), withoutEnlargement: true }).webp({ quality: 82 }).toFile(out);
      gallery.push({ type: 'image', image: '/' + out });
      console.log(slug, n, meta.width + 'x' + meta.height, '->', Math.round(fs.statSync(out).size / 1024) + 'KB');
    } else {
      if (!/bitz\.ge/.test(m.mp4 || m.webm || '')) { console.log(slug, 'skip external video', m.mp4 || m.webm); continue; }
      const item = { type: 'video' };
      for (const k of ['mp4', 'webm']) {
        if (!m[k]) continue;
        const base = decodeURIComponent(path.basename(m[k])).replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').replace(/-mp4$/, '');
        const out = `assets/video/projects/${slug}-${base}.${k}`;
        if (!fs.existsSync(out)) { try { fs.writeFileSync(out, await get(m[k])); } catch (e) { console.log('  FAIL', e.message); continue; } }
        item[k === 'mp4' ? 'video' : 'webm'] = '/' + out;
        console.log(slug, 'video', out, Math.round(fs.statSync(out).size / 1e6 * 10) / 10 + 'MB');
      }
      if (item.video || item.webm) gallery.push(item);
    }
  }
  const j = JSON.parse(fs.readFileSync(file, 'utf8')); j.en.gallery = gallery; delete j.ka?.gallery;
  fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n');
  console.log('==', slug, gallery.length, 'items');
}
