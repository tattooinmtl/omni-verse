<?php
// The signed-in account: who you are and which PCs have the Omniverse app connected.
require __DIR__ . '/_private/page.php';

$u = omv_require_user();
$uid = (int) $u['id'];

if (is_post()) {
    csrf_verify();
    $id = (int) ($_POST['revoke'] ?? 0);
    if ($id) omv_revoke_app($uid, $id);
    redirect('/account.php');
}
$apps = omv_connected_apps($uid);

page_head('Your account — Omniverse');
?>
<section class="panel in narrow">
  <p class="tag">Omni account</p>
  <h2><?= e($u['name'] ?: 'Your account') ?></h2>
  <dl class="kv">
    <dt>Email</dt><dd><?= e($u['email']) ?></dd>
    <dt>Member since</dt><dd><?= e(substr((string) ($u['joined_at'] ?? $u['created_at'] ?? ''), 0, 10)) ?></dd>
  </dl>
  <p class="fine">Name, email and password are shared by every Omni product; change them on <a href="<?= e(omnione_url('/profile.php')) ?>">your OmniOne profile</a>.</p>

  <h3 class="sub-h">Connected Omniverse apps</h3>
  <?php if (!$apps): ?>
    <p>None yet. In the Omniverse app, open <b>Settings → Account</b> and choose <b>Sign in</b>.</p>
  <?php else: ?>
    <ul class="apps">
      <?php foreach ($apps as $a): ?>
        <li>
          <div>
            <b><?= e($a['device_name'] ?: 'Unnamed PC') ?></b>
            <span class="fine"><?= e($a['device_os'] ?: '') ?><?= $a['app_version'] ? ' · v' . e($a['app_version']) : '' ?> · last seen <?= e(substr((string) $a['last_used_at'], 0, 16)) ?> UTC</span>
          </div>
          <form method="post" action="/account.php">
            <?= csrf_field() ?>
            <button class="btn small" type="submit" name="revoke" value="<?= (int) $a['id'] ?>">Disconnect</button>
          </form>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>

  <form method="post" action="/logout.php" class="form-row" style="margin-top:24px">
    <?= csrf_field() ?>
    <button class="btn" type="submit">Sign out</button>
  </form>
</section>
<?php page_foot();
