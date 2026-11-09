// setup-admin-login.js - one-time: puts the GitHub OAuth app keys for "Sign In with GitHub" on the server, OUTSIDE the website,
// at /home/<account>/.bitz-admin-oauth.php, where admin/auth.php reads them. The keys never enter git or the chat.
//
// 1. Luka saves C:\Users\luka_\bitz-agents\.secrets\github-oauth.json as
//      { "client_id": "...", "client_secret": "..." }
// 2. node tools/setup-admin-login.js
// Uses WinSCP's stored "bitz-ftp" session (FTP root = the account's home folder, next to public_html).
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');

const WINSCP = 'C:\\Users\\luka_\\AppData\\Local\\Programs\\WinSCP\\WinSCP.com';
const SRC = 'C:\\Users\\luka_\\bitz-agents\\.secrets\\github-oauth.json';
const ALLOW = ['lukamnm'];   // GitHub accounts that may sign in to the admin

if (!fs.existsSync(SRC)) { console.error(`missing ${SRC}`); process.exit(1); }
const { client_id, client_secret } = JSON.parse(fs.readFileSync(SRC, 'utf8'));
if (!/^[\w.-]{10,}$/.test(client_id || '') || !/^[\w]{20,}$/.test(client_secret || '')) { console.error('github-oauth.json needs client_id and client_secret'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bitz-oauth-'));
const file = path.join(tmp, '.bitz-admin-oauth.php');
const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
fs.writeFileSync(file, `<?php\nreturn ['client_id' => ${q(client_id)}, 'client_secret' => ${q(client_secret)}, 'allow' => [${ALLOW.map(q).join(', ')}]];\n`);
try {
  const out = execFileSync(WINSCP, ['/command', 'open bitz-ftp', 'option batch abort', 'option confirm off', `put ${file} /`, 'chmod 600 /.bitz-admin-oauth.php', 'exit'], { encoding: 'utf8' });
  if (!/\.bitz-admin-oauth\.php/.test(out)) throw new Error(out);
  console.log('uploaded the admin login keys to the server (outside public_html)');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
