<?php
// contact.php - the Contact overlay's form posts here (JSON: name, email, message, lang, page, t, website).
// Sends the message to TO through WordPress's mailer (its SMTP plugin) when WordPress lives on this server, else PHP's own mail().
// Replies: {"ok":true} or {"ok":false,"error":"method|origin|fields|rate|send"}.
declare(strict_types=1);
const TO = 'chat@bitz.ge';
const FROM_DOMAIN = 'bitz.ge';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$out = function (bool $ok, string $error = '', int $code = 200): void { http_response_code($code); echo json_encode(['ok' => $ok] + ($error ? ['error' => $error] : [])); exit; };
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') $out(false, 'method', 405);
$origin = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '';                        // same site only
if ($origin !== '' && strcasecmp((string) parse_url($origin, PHP_URL_HOST), explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]) !== 0) $out(false, 'origin', 403);
$d = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($d)) $d = $_POST;
$cut = fn(string $s, int $max): string => function_exists('mb_substr') ? mb_substr($s, 0, $max, 'UTF-8') : substr($s, 0, $max);
$line = fn(string $k, int $max): string => trim($cut(preg_replace('/[\r\n\t]+/', ' ', (string) ($d[$k] ?? '')) ?? '', $max));   // one line, header-safe
$name = str_replace(['<', '>', '"'], '', $line('name', 120));
$email = $line('email', 200);
$message = trim($cut((string) ($d['message'] ?? ''), 5000));
$lang = ($d['lang'] ?? 'en') === 'ge' ? 'ge' : 'en';
// bots: the hidden field must stay empty, and nobody writes a message in under three seconds (both answered with a quiet ok)
if (($d['website'] ?? '') !== '') $out(true);
$t = (int) ($d['t'] ?? 0);
if ($t > 0 && (int) round(microtime(true) * 1000) - $t < 3000) $out(true);
if ($name === '' || $message === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) $out(false, 'fields', 400);
// five messages per hour per address
$ip = $_SERVER['REMOTE_ADDR'] ?? '0';
$ledger = sys_get_temp_dir() . '/bitz-contact-' . md5($ip);
$hits = is_file($ledger) ? array_map('intval', file($ledger, FILE_IGNORE_NEW_LINES) ?: []) : [];
$hits = array_values(array_filter($hits, fn(int $x): bool => $x > time() - 3600));
if (count($hits) >= 5) $out(false, 'rate', 429);
$hits[] = time();
@file_put_contents($ledger, implode("\n", $hits));
$subject = "bitz.ge: message from $name";
$body = "Name: $name\nEmail: $email\nLanguage: $lang\nPage: " . $line('page', 300) . "\nIP: $ip\n\n$message\n";
$sent = false;
for ($dir = __DIR__, $i = 0; $i < 4; $i++, $dir = dirname($dir)) {                            // WordPress above this folder?
  if (!is_file("$dir/wp-load.php")) continue;
  if (!defined('WP_USE_THEMES')) define('WP_USE_THEMES', false);
  ob_start();
  try { require_once "$dir/wp-load.php"; } catch (Throwable $e) { error_log('bitz contact: wp-load failed: ' . $e->getMessage()); }
  ob_end_clean();
  if (function_exists('wp_mail')) $sent = (bool) wp_mail(TO, $subject, $body, ["Reply-To: $name <$email>"]);
  break;
}
if (!$sent) $sent = @mail(TO, $subject, $body, ['From' => 'bitz.ge <noreply@' . FROM_DOMAIN . '>', 'Reply-To' => "$name <$email>"]);
if (!$sent) { error_log("bitz contact: could not send a message from $email"); $out(false, 'send', 500); }
$out(true);
