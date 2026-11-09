// deploy.js - upload the static site to Hostnodes with WinSCP's stored "bitz-ftp" session (same session the developer
// agent's ftp.js uses; the password never appears here). One-way sync local -> remote, never deletes remote files.
//
//   node tools/deploy.js preview            -> /public_html/preview/bitz/   (hidden preview folder, same domain)
//   node tools/deploy.js preview <name>     -> /public_html/preview/<name>/ (a named preview, e.g. a branch)
//
// Guardrails: the remote target must live under /public_html/preview/ (going live is a separate, explicit step later),
// and the dev server, tools, the WordPress export and git metadata are never uploaded.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WINSCP = 'C:\\Users\\luka_\\AppData\\Local\\Programs\\WinSCP\\WinSCP.com';
const SITE = path.resolve(__dirname, '..');
const [mode, name = 'bitz'] = process.argv.slice(2);
if (mode !== 'preview') { console.error('usage: node tools/deploy.js preview [name]'); process.exit(1); }
if (!/^[a-z0-9-]{1,40}$/.test(name)) { console.error('preview name: lowercase letters, digits, hyphens'); process.exit(1); }
const remote = `/public_html/preview/${name}`;
const exclude = ['server.js', 'tools/', 'content/', '.git/', '.gitattributes', '.gitignore', '*.md', 'node_modules/'];
const mask = `|${exclude.join(';')}`;
if (/\s|"/.test(SITE)) { console.error('the site folder path must not contain spaces or quotes (WinSCP argument quoting)'); process.exit(1); }
// Build step: copy the site to a temp folder and stamp every referenced script, style, data and vendor file with ?v=<content hash>.
// bitz.ge sits behind Cloudflare (4 h edge cache for static files), so without this a deploy keeps serving the previous app.js.
const crypto = require('crypto'), os = require('os');
const BUILD = path.join(os.tmpdir(), 'bitz-site-build');
fs.rmSync(BUILD, { recursive: true, force: true });
const skip = p => { const rel = path.relative(SITE, p).replace(/\\/g, '/'); return exclude.some(x => x.endsWith('/') ? rel === x.slice(0, -1) || rel.startsWith(x) : (x.startsWith('*') ? rel.endsWith(x.slice(1)) : rel === x)); };
fs.cpSync(SITE, BUILD, { recursive: true, filter: p => p === SITE || !skip(p) });
const hashOf = rel => { const f = path.join(BUILD, rel); return fs.existsSync(f) ? crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 8) : null; };
const stamp = (file, re) => {
  const f = path.join(BUILD, file); if (!fs.existsSync(f)) return;
  let s = fs.readFileSync(f, 'utf8'), n = 0;
  s = s.replace(re, (m, rel) => { const h = hashOf(rel); if (!h) return m; n++; return m.replace(rel, `${rel}?v=${h}`); });
  fs.writeFileSync(f, s); console.log(`stamped ${n} references in ${file}`);
};
stamp('app.js', /(?<=['"(])((?:\.\/)?(?:assets\/vendor\/[\w.-]+\.js|data\/[\w-]+\.json))(?=['")?])/g);
stamp('style.css', /(?<=url\()((?:assets\/fonts\/[\w.-]+\.woff2))(?=\))/g);
stamp('index.html', /(?<=["'])((?:\.\/)?(?:app\.js|style\.css|assets\/img\/logo\.svg|assets\/vendor\/[\w.-]+\.js))(?=["'])/g);   // app.js last: its own hash includes the stamped data paths; also the import map and vendor scripts
const start = Date.now();
// no quotes anywhere in these commands: node's Windows argument quoting would escape them and WinSCP would see broken paths
let out;
try {
  out = execFileSync(WINSCP, [
    '/command', 'open bitz-ftp', 'option confirm off', 'option batch continue',
    `mkdir ${remote}`,                                                  // fails harmlessly if it exists
    'option batch abort',
    `synchronize remote -mirror=off -criteria=either ${BUILD} ${remote}`,
    'exit',
  ], { encoding: 'utf8', timeout: 900000, maxBuffer: 50 * 1024 * 1024 });
} catch (e) { out = (e.stdout || '') + (e.stderr || ''); fs.writeFileSync(path.join(__dirname, 'deploy.log'), out); console.error('deploy failed, see tools/deploy.log'); console.error(out.split(/\r?\n/).filter(l => /error|fail|incorrect/i.test(l)).join('\n')); process.exit(1); }
fs.writeFileSync(path.join(__dirname, 'deploy.log'), out);
const lines = out.split(/\r?\n/);
const uploaded = lines.filter(l => /^[A-Za-z]:\\.*\|/.test(l) || /\|\s+\d+ (KB|B|MB)\s+\|/.test(l)).length;
console.log(lines.filter(l => /error|fail/i.test(l)).join('\n'));
console.log(`synced ${SITE} -> ${remote} in ${Math.round((Date.now() - start) / 1000)} s (${uploaded} transfers)`);
console.log(`preview: https://bitz.ge/preview/${name}/`);
