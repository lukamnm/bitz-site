// stage.js - builds the deployable copy of the site into a folder: runs tools/build.mjs (content -> data), copies the site without the
// dev-only files, and stamps every script, style, font, vendor and data reference with ?v=<content hash>. bitz.ge sits behind Cloudflare
// (4 h edge cache for static files), so without the stamps a deploy keeps serving the previous app.js.
// Used by tools/deploy.js (local, WinSCP) and by the GitHub deploy workflow.   usage: node tools/stage.js <outDir>
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const SITE = path.resolve(__dirname, '..');
const EXCLUDE = ['server.js', 'tools/', 'content/', '.git/', '.github/', '.gitattributes', '.gitignore', '*.md', 'node_modules/', '_site/'];

function stage(outDir) {
  execFileSync(process.execPath, [path.join(__dirname, 'build.mjs')], { cwd: SITE, stdio: 'inherit' });
  outDir = path.resolve(outDir);
  fs.rmSync(outDir, { recursive: true, force: true });
  const skip = p => { const rel = path.relative(SITE, p).replace(/\\/g, '/'); return EXCLUDE.some(x => x.endsWith('/') ? rel === x.slice(0, -1) || rel.startsWith(x) : (x.startsWith('*') ? rel.endsWith(x.slice(1)) : rel === x)); };
  // copy entry by entry so the output folder may sit inside the site (the GitHub workflow builds into ./_site)
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of fs.readdirSync(SITE)) {
    const src = path.join(SITE, name);
    if (src === outDir || skip(src)) continue;
    fs.cpSync(src, path.join(outDir, name), { recursive: true, filter: p => !skip(p) });
  }
  const hashOf = rel => { const f = path.join(outDir, rel); return fs.existsSync(f) ? crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 8) : null; };
  const stamp = (file, re) => {
    const f = path.join(outDir, file); if (!fs.existsSync(f)) return;
    let s = fs.readFileSync(f, 'utf8'), n = 0;
    s = s.replace(re, (m, rel) => { const h = hashOf(rel); if (!h) return m; n++; return m.replace(rel, `${rel}?v=${h}`); });
    fs.writeFileSync(f, s); console.log(`stamped ${n} references in ${file}`);
  };
  stamp('app.js', /(?<=['"(])((?:\.\/)?(?:assets\/vendor\/[\w.-]+\.js|data\/[\w-]+\.json))(?=['")?])/g);
  stamp('style.css', /(?<=url\()((?:assets\/fonts\/[\w.-]+\.woff2))(?=\))/g);
  stamp('index.html', /(?<=["'])((?:\.\/)?(?:app\.js|style\.css|assets\/img\/logo\.svg|assets\/vendor\/[\w.-]+\.js|assets\/loader\/[\w.-]+\.json))(?=["'])/g);   // + the loader animation   // app.js last: its hash includes the stamped data paths
  // a real page per address (same stamped index.html, each with its own head and readable text), sitemap, robots, 404, .htaccess
  execFileSync(process.execPath, [path.join(__dirname, 'pages.mjs'), outDir], { cwd: SITE, stdio: 'inherit' });
  return outDir;
}
module.exports = { stage, SITE };
if (require.main === module) {
  const out = process.argv[2]; if (!out) { console.error('usage: node tools/stage.js <outDir>'); process.exit(1); }
  stage(path.resolve(out)); console.log('staged into', path.resolve(out));
}
