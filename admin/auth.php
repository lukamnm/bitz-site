<?php
// auth.php - "Sign In with GitHub" for the bitz admin (Sveltia CMS). A tiny OAuth helper that runs on the Hostnodes PHP:
//   1. the admin opens this page in a popup  -> we redirect to GitHub's authorize page (with a random state in a cookie)
//   2. GitHub sends the browser back here with ?code -> we swap the code for a token (needs the client secret, server side)
//   3. we hand the token to the admin window with the postMessage handshake Sveltia / Decap expect, then the popup closes.
// The OAuth app's id and secret live OUTSIDE the website, in /home/<account>/.bitz-admin-oauth.php (never in git):
//   <?php return ['client_id' => '...', 'client_secret' => '...', 'allow' => ['lukamnm']];
// 'allow' lists the GitHub accounts that may sign in; anyone else gets a clear error instead of a token.

declare(strict_types=1);
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
header('Referrer-Policy: no-referrer');

const ALLOWED_ORIGINS = ['https://bitz.ge', 'https://www.bitz.ge'];
const STATE_COOKIE = 'bitz_admin_oauth_state';

function finish(string $status, array $content): void {
  // popup -> opener handshake: we announce "authorizing:github", the admin echoes it back from its origin, then we answer that origin
  $msg = 'authorization:github:' . $status . ':' . json_encode($content, JSON_UNESCAPED_SLASHES);
  $js = json_encode($msg, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
  $origins = json_encode(ALLOWED_ORIGINS, JSON_UNESCAPED_SLASHES);
  $note = $status === 'success' ? 'Signed in. This window closes by itself.' : htmlspecialchars($content['error'] ?? 'Sign-in failed.', ENT_QUOTES);
  header('Content-Type: text/html; charset=utf-8');
  echo <<<HTML
<!doctype html><meta charset="utf-8"><title>bitz admin</title>
<body style="font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<p>{$note}</p>
<script>
(() => {
  const msg = {$js}, ok = {$origins};
  window.addEventListener('message', ({ data, origin }) => {
    if (data === 'authorizing:github' && ok.includes(origin)) window.opener && window.opener.postMessage(msg, origin);
  });
  if (window.opener) ok.forEach(o => window.opener.postMessage('authorizing:github', o));
})();
</script>
HTML;
  exit;
}

function fail(string $error, string $code = 'unknown'): void { finish('error', ['provider' => 'github', 'error' => $error, 'errorCode' => $code]); }

$cfgFile = dirname($_SERVER['DOCUMENT_ROOT']) . '/.bitz-admin-oauth.php';
if (!is_file($cfgFile)) fail('The sign-in helper is not configured yet.', 'not_configured');
$cfg = require $cfgFile;
$clientId = (string)($cfg['client_id'] ?? '');
$secret = (string)($cfg['client_secret'] ?? '');
$allow = array_map('strtolower', (array)($cfg['allow'] ?? []));
if ($clientId === '' || $secret === '') fail('The sign-in helper is missing its GitHub app keys.', 'not_configured');

$self = 'https://' . $_SERVER['HTTP_HOST'] . strtok($_SERVER['REQUEST_URI'], '?');
$cookiePath = strtok($_SERVER['REQUEST_URI'], '?');

// step 2: GitHub came back
if (isset($_GET['code']) || isset($_GET['error'])) {
  $state = (string)($_GET['state'] ?? '');
  $saved = (string)($_COOKIE[STATE_COOKIE] ?? '');
  setcookie(STATE_COOKIE, '', ['expires' => time() - 3600, 'path' => $cookiePath, 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
  if (isset($_GET['error'])) fail('GitHub sign-in was cancelled.', 'access_denied');
  if ($saved === '' || !hash_equals($saved, $state)) fail('The sign-in link expired. Please try again.', 'csrf_detected');

  $ch = curl_init('https://github.com/login/oauth/access_token');
  curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => http_build_query(['client_id' => $clientId, 'client_secret' => $secret, 'code' => (string)$_GET['code'], 'redirect_uri' => $self]),
    CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: bitz-admin-auth'],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
  ]);
  $res = json_decode((string)curl_exec($ch), true) ?: [];
  curl_close($ch);
  $token = (string)($res['access_token'] ?? '');
  if ($token === '') fail('GitHub did not return a token (' . ($res['error'] ?? 'no response') . ').', 'token_failed');

  if ($allow) {   // only the listed GitHub accounts get through
    $ch = curl_init('https://api.github.com/user');
    curl_setopt_array($ch, [
      CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token, 'Accept: application/vnd.github+json', 'User-Agent: bitz-admin-auth'],
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT => 20,
    ]);
    $user = json_decode((string)curl_exec($ch), true) ?: [];
    curl_close($ch);
    if (!in_array(strtolower((string)($user['login'] ?? '')), $allow, true)) fail('This GitHub account cannot edit bitz.ge.', 'not_allowed');
  }
  finish('success', ['provider' => 'github', 'token' => $token]);
}

// step 1: the admin opened the popup
if (($_GET['provider'] ?? 'github') !== 'github') fail('Only GitHub sign-in is supported.', 'unsupported_backend');
$scope = in_array($_GET['scope'] ?? '', ['repo', 'public_repo'], true) ? $_GET['scope'] : 'repo';
$state = bin2hex(random_bytes(16));
setcookie(STATE_COOKIE, $state, ['expires' => time() + 600, 'path' => $cookiePath, 'secure' => true, 'httponly' => true, 'samesite' => 'Lax']);
header('Location: https://github.com/login/oauth/authorize?' . http_build_query([
  'client_id' => $clientId, 'redirect_uri' => $self, 'scope' => $scope, 'state' => $state, 'allow_signup' => 'false',
]), true, 302);
