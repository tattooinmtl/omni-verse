<?php
// Connect the Omniverse app to this account: the page the app opens in the
// browser. The person signs in here as usual, checks the code matches the
// app, sees which PC is asking, and approves or declines.
require __DIR__ . '/_private/page.php';

$u = omv_require_user();
$uid = (int) $u['id'];
$code = normalize_user_code((string) ($_GET['code'] ?? $_POST['code'] ?? ''));
$done = null;
$err = null;

if (is_post()) {
    csrf_verify();
    if (!rate_hit('omv:connect-decide:' . $uid, 20, 3600)) {
        $err = 'Too many attempts. Try again in an hour.';
    } else {
        $pending = omv_device_code_pending($code);
        if (!$pending) {
            $err = 'That code has expired or was already used. Start again from the Omniverse app.';
        } else {
            $approve = ($_POST['decision'] ?? '') === 'approve';
            omv_device_code_decide((int) $pending['id'], $uid, $approve);
            $done = $approve ? 'approved' : 'denied';
        }
    }
}
$pending = $done ? null : ($code !== '' ? omv_device_code_pending($code) : null);

page_head('Connect the Omniverse app — Omniverse');
?>
<section class="panel in narrow">
  <p class="tag">Connect</p>
  <h2>Connect the Omniverse app</h2>
  <?php if ($done === 'approved'): ?>
    <p class="ok-line">✓ Connected.</p>
    <p>Go back to the Omniverse; it signs in by itself within a few seconds. You can close this tab. To disconnect later, use <b>Sign out</b> in the app or your <a href="/account.php">account page</a>.</p>
  <?php elseif ($done === 'denied'): ?>
    <p>Declined. Nothing was connected.</p>
  <?php else: ?>
    <?= form_error($err) ?>
    <?php if ($pending): ?>
      <p>Check that the Omniverse app shows this same code, and that you started this on your own computer.</p>
      <div class="code-box"><?= e($pending['user_code']) ?></div>
      <dl class="kv">
        <dt>Computer</dt><dd><?= e($pending['device_name'] ?: 'Unnamed PC') ?></dd>
        <dt>System</dt><dd><?= e($pending['device_os'] ?: '—') ?></dd>
        <dt>Omniverse</dt><dd><?= e($pending['app_version'] ? 'v' . $pending['app_version'] : '—') ?></dd>
        <dt>Account</dt><dd><?= e($u['name']) ?> · <?= e($u['email']) ?></dd>
      </dl>
      <p class="fine">Approving lets this copy of the Omniverse show who is signed in. It never gets your password.</p>
      <form method="post" action="/connect.php" class="form-row">
        <?= csrf_field() ?>
        <input type="hidden" name="code" value="<?= e($pending['user_code']) ?>">
        <button class="btn primary" type="submit" name="decision" value="approve">Approve</button>
        <button class="btn" type="submit" name="decision" value="deny">Decline</button>
      </form>
      <p class="fine">Didn’t start this yourself? Decline it.</p>
    <?php else: ?>
      <?php if ($code !== '' && !$err): ?><div class="flash flash--error">That code has expired or was already used. Start again from the Omniverse app.</div><?php endif; ?>
      <p>Enter the code the Omniverse app shows you.</p>
      <form class="form" method="get" action="/connect.php">
        <label>Code<input name="code" placeholder="XXXX-XXXX" maxlength="9" autocomplete="off" required autofocus></label>
        <div class="form-row"><button class="btn primary" type="submit">Continue</button></div>
      </form>
    <?php endif; ?>
  <?php endif; ?>
</section>
<?php page_foot();
