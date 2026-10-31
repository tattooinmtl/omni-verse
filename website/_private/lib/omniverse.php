<?php
// Omniverse's own parts: the visit counter and connecting the Omniverse app.
// Codes, devices and the account payload come from OmniOne's connect.php;
// the rows live in Omniverse's own tables (see _setup/omniverse_migration_001.sql).

const OMV_VISIT_GAP = 30 * 60; // a reload within 30 minutes isn't a new visit

function omnione_url(string $path = ''): string
{
    return rtrim((string) config('omnione_url', 'https://omnione.globalwarningnetworks.com'), '/') . '/' . ltrim($path, '/');
}

// --- visits ----------------------------------------------------------------

/* Log this page load with the visitor's IP, and say whether it's a new visit. */
function omv_record_visit(string $path, string $referrer, ?int $userId): void
{
    $ip = client_ip();
    $recent = row('SELECT id FROM omniverse_visits WHERE ip = ? AND created_at > ? LIMIT 1', [$ip, now_utc(-OMV_VISIT_GAP)]);
    insert('omniverse_visits', [
        'ip' => $ip,
        'user_agent' => substr(user_agent(), 0, 255) ?: null,
        'path' => substr($path, 0, 255) ?: null,
        'referrer' => substr($referrer, 0, 255) ?: null,
        'user_id' => $userId,
        'counted' => $recent ? 0 : 1,
        'created_at' => now_utc(),
    ]);
}

function omv_visit_stats(): array
{
    $r = row('SELECT SUM(counted) AS visits, COUNT(DISTINCT ip) AS visitors,
                     SUM(counted AND created_at >= ?) AS today
              FROM omniverse_visits', [gmdate('Y-m-d 00:00:00')]);
    return ['visits' => (int) ($r['visits'] ?? 0), 'visitors' => (int) ($r['visitors'] ?? 0), 'today' => (int) ($r['today'] ?? 0)];
}

// --- connecting the app (device-code flow, as OmniOne does it) ---------------

function omv_device_code_start(array $dev): ?array
{
    if (!rate_hit('omv:devcode:ip:' . client_ip(), 20, 3600)) return null;
    $deviceCode = random_token(32);
    do { $userCode = new_user_code(); }
    while (row("SELECT id FROM omniverse_device_codes WHERE user_code = ? AND status = 'pending' AND expires_at > ?", [$userCode, now_utc()]));
    insert('omniverse_device_codes', [
        'device_code_hash' => hash('sha256', $deviceCode),
        'user_code' => $userCode,
        'device_uid' => $dev['uid'],
        'device_name' => $dev['name'],
        'device_os' => $dev['os'],
        'app_version' => $dev['app_version'],
        'status' => 'pending',
        'created_ip' => client_ip(),
        'created_at' => now_utc(),
        'expires_at' => now_utc(DEVICE_CODE_TTL),
    ]);
    return [
        'device_code' => $deviceCode,
        'user_code' => $userCode,
        'verify_url' => site_url('/connect.php?code=' . $userCode),
        'interval' => 3,
        'expires_in' => DEVICE_CODE_TTL,
    ];
}

function omv_device_code_pending(string $userCode): ?array
{
    $userCode = normalize_user_code($userCode);
    if ($userCode === '') return null;
    return row("SELECT * FROM omniverse_device_codes WHERE user_code = ? AND status = 'pending' AND expires_at > ? ORDER BY id DESC LIMIT 1",
        [$userCode, now_utc()]);
}

function omv_device_code_decide(int $codeId, int $userId, bool $approve): void
{
    q("UPDATE omniverse_device_codes SET status = ?, user_id = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
        [$approve ? 'approved' : 'denied', $userId, now_utc(), $codeId]);
}

/* One live token per PC: connecting again replaces the old one. */
function omv_issue_token(int $userId, array $dev): string
{
    q('UPDATE omniverse_app_tokens SET revoked_at = ? WHERE user_id = ? AND device_uid = ? AND revoked_at IS NULL',
        [now_utc(), $userId, $dev['uid']]);
    $token = 'omv_' . random_token(24);
    insert('omniverse_app_tokens', [
        'user_id' => $userId,
        'device_uid' => $dev['uid'],
        'device_name' => $dev['name'],
        'device_os' => $dev['os'],
        'app_version' => $dev['app_version'],
        'token_hash' => hash('sha256', $token),
        'created_at' => now_utc(),
        'last_used_at' => now_utc(),
        'last_ip' => client_ip(),
    ]);
    return $token;
}

function omv_device_code_poll(string $deviceCode): array
{
    if (!preg_match('/^[a-f0-9]{64}$/', $deviceCode)) return ['status' => 'expired'];
    $r = row('SELECT * FROM omniverse_device_codes WHERE device_code_hash = ?', [hash('sha256', $deviceCode)]);
    if (!$r) return ['status' => 'expired'];
    if (!rate_hit('omv:devpoll:' . $r['id'], 400, DEVICE_CODE_TTL)) return ['status' => 'slow_down'];
    if ($r['status'] === 'denied') return ['status' => 'denied'];
    if ($r['status'] === 'consumed' || $r['expires_at'] <= now_utc()) return ['status' => 'expired'];
    if ($r['status'] !== 'approved') return ['status' => 'pending'];

    // Approved: hand the token out exactly once.
    q("UPDATE omniverse_device_codes SET status = 'consumed' WHERE id = ? AND status = 'approved'", [$r['id']]);
    $userId = (int) $r['user_id'];
    $acct = load_account($userId);
    if (!$acct || $acct['status'] !== 'active' || !is_verified($acct)) return ['status' => 'denied'];
    $token = omv_issue_token($userId, ['uid' => $r['device_uid'], 'name' => $r['device_name'], 'os' => $r['device_os'], 'app_version' => $r['app_version']]);
    log_login($userId, $acct['email'], true, 'app', 'omniverse_device_code'); // source is enum('web','app')
    return ['status' => 'approved', 'token' => $token, 'user' => app_user_payload($userId)];
}

/* The account behind an app's token, or null. */
function omv_token_account(string $token): ?array
{
    if (!preg_match('/^omv_[a-f0-9]{48}$/', $token)) return null;
    $row = row('SELECT t.id AS token_id, t.user_id, a.status, a.email_verified_at
                FROM omniverse_app_tokens t JOIN omni_accounts a ON a.user_id = t.user_id
                WHERE t.token_hash = ? AND t.revoked_at IS NULL', [hash('sha256', $token)]);
    if (!$row || $row['status'] !== 'active' || !$row['email_verified_at']) return null;
    q('UPDATE omniverse_app_tokens SET last_used_at = ?, last_ip = ? WHERE id = ?', [now_utc(), client_ip(), $row['token_id']]);
    return $row;
}

/* The account's connected Omniverse apps, for the account page. */
function omv_connected_apps(int $userId): array
{
    return rows('SELECT id, device_name, device_os, app_version, created_at, last_used_at
                 FROM omniverse_app_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_used_at DESC', [$userId]);
}

function omv_revoke_app(int $userId, int $tokenId): void
{
    q('UPDATE omniverse_app_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [now_utc(), $tokenId, $userId]);
}

/* Signed in and verified, or off to sign in (or to OmniOne to verify the email). */
function omv_require_user(): array
{
    $u = current_user();
    if (!$u) redirect('/login.php?next=' . rawurlencode($_SERVER['REQUEST_URI'] ?? '/account.php'));
    if (!is_verified($u)) {
        header('Location: ' . omnione_url('/verify.php'));
        exit;
    }
    return $u;
}
