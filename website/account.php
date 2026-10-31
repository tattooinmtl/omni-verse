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

page_head(tr('Your account — Omniverse', 'Votre compte — Omniverse'));
?>
<section class="panel in narrow">
  <p class="tag"><?= e(tr('Omni account', 'Compte Omni')) ?></p>
  <h2><?= e($u['name'] ?: tr('Your account', 'Votre compte')) ?></h2>
  <dl class="kv">
    <dt><?= e(tr('Email', 'Courriel')) ?></dt><dd><?= e($u['email']) ?></dd>
    <dt><?= e(tr('Member since', 'Membre depuis')) ?></dt><dd><?= e(substr((string) ($u['joined_at'] ?? $u['created_at'] ?? ''), 0, 10)) ?></dd>
  </dl>
  <p class="fine"><?= tr('Name, email and password are shared by every Omni product; change them on', 'Le nom, le courriel et le mot de passe sont communs à tous les produits Omni; modifiez-les dans') ?> <a href="<?= e(omnione_url('/profile.php')) ?>"><?= e(tr('your OmniOne profile', 'votre profil OmniOne')) ?></a>.</p>

  <h3 class="sub-h"><?= e(tr('Connected Omniverse apps', 'Applications Omniverse branchées')) ?></h3>
  <?php if (!$apps): ?>
    <p><?= tr('None yet. In the Omniverse app, open <b>Settings → Account</b> and choose <b>Sign in</b>.', 'Aucune pour l’instant. Dans l’application Omniverse, ouvrez <b>Settings → Account</b> et choisissez <b>Sign in</b>.') ?></p>
  <?php else: ?>
    <ul class="apps">
      <?php foreach ($apps as $a): ?>
        <li>
          <div>
            <b><?= e($a['device_name'] ?: tr('Unnamed PC', 'PC sans nom')) ?></b>
            <span class="fine"><?= e($a['device_os'] ?: '') ?><?= $a['app_version'] ? ' · v' . e($a['app_version']) : '' ?> · <?= e(tr('last seen', 'vu pour la dernière fois le')) ?> <?= e(substr((string) $a['last_used_at'], 0, 16)) ?> UTC</span>
          </div>
          <form method="post" action="/account.php">
            <?= csrf_field() ?>
            <button class="btn small" type="submit" name="revoke" value="<?= (int) $a['id'] ?>"><?= e(tr('Disconnect', 'Débrancher')) ?></button>
          </form>
        </li>
      <?php endforeach; ?>
    </ul>
  <?php endif; ?>

  <form method="post" action="/logout.php" class="form-row" style="margin-top:24px">
    <?= csrf_field() ?>
    <button class="btn" type="submit"><?= e(tr('Sign out', 'Se déconnecter')) ?></button>
  </form>
</section>
<?php page_foot();
