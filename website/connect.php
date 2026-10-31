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

page_head(tr('Connect the Omniverse app — Omniverse', 'Brancher l’application Omniverse — Omniverse'));
?>
<section class="panel in narrow">
  <p class="tag"><?= e(tr('Connect', 'Brancher')) ?></p>
  <h2><?= e(tr('Connect the Omniverse app', 'Brancher l’application Omniverse')) ?></h2>
  <?php if ($done === 'approved'): ?>
    <p class="ok-line">✓ <?= e(tr('Connected.', 'Branchée.')) ?></p>
    <p><?= tr(
        'Go back to the Omniverse; it signs in by itself within a few seconds. You can close this tab. To disconnect later, use <b>Sign out</b> in the app or your <a href="/account.php">account page</a>.',
        'Retournez dans l’Omniverse; il se connecte tout seul en quelques secondes. Vous pouvez fermer cet onglet. Pour le débrancher plus tard, utilisez <b>Sign out</b> dans l’application ou la <a href="/account.php">page de votre compte</a>.'
    ) ?></p>
  <?php elseif ($done === 'denied'): ?>
    <p><?= e(tr('Declined. Nothing was connected.', 'Refusé. Rien n’a été branché.')) ?></p>
  <?php else: ?>
    <?= form_error($err) ?>
    <?php if ($pending): ?>
      <p><?= e(tr('Check that the Omniverse app shows this same code, and that you started this on your own computer.', 'Vérifiez que l’application Omniverse affiche ce même code et que c’est bien vous qui avez lancé cette demande, sur votre propre ordinateur.')) ?></p>
      <div class="code-box"><?= e($pending['user_code']) ?></div>
      <dl class="kv">
        <dt><?= e(tr('Computer', 'Ordinateur')) ?></dt><dd><?= e($pending['device_name'] ?: tr('Unnamed PC', 'PC sans nom')) ?></dd>
        <dt><?= e(tr('System', 'Système')) ?></dt><dd><?= e($pending['device_os'] ?: '—') ?></dd>
        <dt>Omniverse</dt><dd><?= e($pending['app_version'] ? 'v' . $pending['app_version'] : '—') ?></dd>
        <dt><?= e(tr('Account', 'Compte')) ?></dt><dd><?= e($u['name']) ?> · <?= e($u['email']) ?></dd>
      </dl>
      <p class="fine"><?= e(tr('Approving lets this copy of the Omniverse show who is signed in. It never gets your password.', 'Approuver permet à cette copie de l’Omniverse d’afficher qui est connecté. Elle n’obtient jamais votre mot de passe.')) ?></p>
      <form method="post" action="/connect.php" class="form-row">
        <?= csrf_field() ?>
        <input type="hidden" name="code" value="<?= e($pending['user_code']) ?>">
        <button class="btn primary" type="submit" name="decision" value="approve"><?= e(tr('Approve', 'Approuver')) ?></button>
        <button class="btn" type="submit" name="decision" value="deny"><?= e(tr('Decline', 'Refuser')) ?></button>
      </form>
      <p class="fine"><?= e(tr('Didn’t start this yourself? Decline it.', 'Ce n’est pas vous qui avez lancé cette demande? Refusez-la.')) ?></p>
    <?php else: ?>
      <?php if ($code !== '' && !$err): ?><?= form_error('That code has expired or was already used. Start again from the Omniverse app.') ?><?php endif; ?>
      <p><?= e(tr('Enter the code the Omniverse app shows you.', 'Entrez le code que l’application Omniverse vous affiche.')) ?></p>
      <form class="form" method="get" action="/connect.php">
        <label><?= e(tr('Code', 'Code')) ?><input name="code" placeholder="XXXX-XXXX" maxlength="9" autocomplete="off" required autofocus></label>
        <div class="form-row"><button class="btn primary" type="submit"><?= e(tr('Continue', 'Continuer')) ?></button></div>
      </form>
    <?php endif; ?>
  <?php endif; ?>
</section>
<?php page_foot();
