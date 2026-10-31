<?php
// Sign in with an Omni account: the same email and password as OmniOne.
require __DIR__ . '/_private/page.php';

$next = (string) ($_GET['next'] ?? $_POST['next'] ?? '/account.php');
if (!preg_match('#^/(?!/)#', $next)) $next = '/account.php';

if (current_user()) redirect($next);

$err = null;
$email = '';
if (is_post()) {
    csrf_verify();
    $email = (string) ($_POST['email'] ?? '');
    [$u, $err] = attempt_login($email, (string) ($_POST['password'] ?? ''), 'web');
    if ($u) {
        sign_in($u);
        if (!is_verified($u)) { header('Location: ' . omnione_url('/verify.php')); exit; }
        redirect($next);
    }
}

page_head(tr('Sign in — Omniverse', 'Connexion — Omniverse'));
?>
<section class="panel in narrow">
  <p class="tag"><?= e(tr('Omni account', 'Compte Omni')) ?></p>
  <h2><?= e(tr('Sign in', 'Connexion')) ?></h2>
  <p><?= e(tr('One account for every Omni product: use the email and password you use for OmniOne.', 'Un seul compte pour tous les produits Omni : utilisez le courriel et le mot de passe de votre compte OmniOne.')) ?></p>
  <?= form_error($err) ?>
  <form class="form" method="post" action="/login.php" novalidate>
    <?= csrf_field() ?>
    <input type="hidden" name="next" value="<?= e($next) ?>">
    <label><?= e(tr('Email', 'Courriel')) ?><input type="email" name="email" value="<?= e($email) ?>" autocomplete="email" required autofocus></label>
    <label><?= e(tr('Password', 'Mot de passe')) ?><input type="password" name="password" autocomplete="current-password" required></label>
    <p class="fine"><?= tr(
        'Signing in, or creating an Omni account, means you accept the <a href="/legal/" target="_blank" rel="noopener">EULA, Terms of Use and Privacy and Cookie Policy</a> for every Omni product. They are experimental AI software for advanced users, with no warranty, used at your own risk.',
        'Vous connecter ou créer un compte Omni signifie que vous acceptez le <a href="/legal/" target="_blank" rel="noopener">CLUF, les conditions d’utilisation et la politique de confidentialité et de témoins</a> de tous les produits Omni. Ce sont des logiciels d’IA expérimentaux pour utilisateurs avancés, sans garantie, utilisés à vos propres risques.'
    ) ?></p>
    <div class="form-row">
      <button class="btn primary" type="submit"><?= e(tr('Sign in', 'Se connecter')) ?></button>
      <span class="form-links">
        <a href="<?= e(omnione_url('/forgot.php')) ?>"><?= e(tr('Forgot password?', 'Mot de passe oublié?')) ?></a> ·
        <a href="<?= e(omnione_url('/register.php')) ?>"><?= e(tr('Create an Omni account', 'Créer un compte Omni')) ?></a>
      </span>
    </div>
  </form>
</section>
<?php page_foot();
