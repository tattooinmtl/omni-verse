<?php
// Omniverse website API: /api/<route> (rewritten to api/index.php?r=<route>).
//
//   POST visit              {path?, ref?}            → log this page load, return the counter
//   GET  stats                                       → the counter, without logging
//   GET  session                                     → who is signed in on this site (cookie), or null
//   POST auth/device/start  {device:{uid, name, os, app_version}} → codes for connecting the app
//   POST auth/device/poll   {device_code}            → pending | approved (+ token, user) | denied | expired
//   GET  me                 Authorization: Bearer omv_…  → the connected account
//   POST auth/logout        Authorization: Bearer omv_…  → disconnect this app

declare(strict_types=1);
require __DIR__ . '/../_private/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function out(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode(['ok' => $status < 400] + $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
function fail(string $code, string $message, int $status = 400): never
{
    out(['error' => $code, 'message' => $message], $status);
}
set_exception_handler(function (Throwable $e) {
    error_log('[omniverse api] ' . $e);
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'server_error', 'message' => 'Something went wrong on the server.']);
});

function body(): array
{
    static $b = null;
    if ($b !== null) return $b;
    $raw = file_get_contents('php://input', false, null, 0, 65537);
    if ($raw === false || strlen($raw) > 65536) fail('too_large', 'Request body is too large.', 413);
    if ($raw === '') return $b = [];
    $j = json_decode($raw, true);
    if (!is_array($j)) fail('bad_json', 'Send a JSON object.');
    return $b = $j;
}
function bearer(): string
{
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+(\S+)$/i', $h, $m)) return $m[1];
    return (string) ($_SERVER['HTTP_X_OMNI_TOKEN'] ?? '');
}
function app_account(): array
{
    $a = omv_token_account(bearer());
    if (!$a) fail('unauthorized', 'Sign in again.', 401);
    return $a;
}
/* Browser-only routes must come from this site's own pages. */
function same_site(): void
{
    $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($site !== '' && $site !== 'same-origin') fail('forbidden', 'Not from this site.', 403);
}

$route = trim((string) ($_GET['r'] ?? ''), '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$want = function (string $m) use ($method) {
    if ($method !== $m) fail('method_not_allowed', "Use $m.", 405);
};

switch ($route) {
    case 'visit': {
        $want('POST');
        same_site();
        // A visitor hammering reload still gets a counter, just not a row per hit.
        if (rate_hit('omv:visit:' . client_ip(), 120, 3600)) {
            session_boot();
            $uid = (int) ($_SESSION['uid'] ?? 0) ?: null;
            omv_record_visit(substr((string) (body()['path'] ?? '/'), 0, 255), substr((string) (body()['ref'] ?? ''), 0, 255), $uid);
        }
        out(omv_visit_stats());
    }

    case 'stats': {
        $want('GET');
        out(omv_visit_stats());
    }

    case 'session': {
        $want('GET');
        same_site();
        session_boot();
        $u = current_user();
        out(['user' => $u ? ['name' => $u['name'] ?: $u['email'], 'verified' => is_verified($u)] : null]);
    }

    case 'auth/device/start': {
        $want('POST');
        $dev = clean_device(is_array(body()['device'] ?? null) ? body()['device'] : []);
        if (!$dev) fail('bad_device', 'device.uid must be 8–64 letters, digits, - or _.');
        $r = omv_device_code_start($dev);
        if (!$r) fail('rate_limited', 'Too many connection attempts from here. Try again in an hour.', 429);
        out($r);
    }

    case 'auth/device/poll': {
        $want('POST');
        $code = is_string(body()['device_code'] ?? null) ? body()['device_code'] : '';
        out(omv_device_code_poll($code));
    }

    case 'me': {
        $want('GET');
        $a = app_account();
        out(['user' => app_user_payload((int) $a['user_id']), 'server_time' => now_utc()]);
    }

    case 'auth/logout': {
        $want('POST');
        $a = app_account();
        q('UPDATE omniverse_app_tokens SET revoked_at = ? WHERE id = ?', [now_utc(), $a['token_id']]);
        out(['signed_out' => true]);
    }

    default:
        fail('not_found', 'No such API route.', 404);
}
