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

page_head('Sign in — Omniverse');
?>
<section class="panel in narrow">
  <p class="tag">Omni account</p>
  <h2>Sign in</h2>
  <p>One account for every Omni product: use the email and password you use for OmniOne.</p>
  <?= form_error($err) ?>
  <form class="form" method="post" action="/login.php" novalidate>
    <?= csrf_field() ?>
    <input type="hidden" name="next" value="<?= e($next) ?>">
    <label>Email<input type="email" name="email" value="<?= e($email) ?>" autocomplete="email" required autofocus></label>
    <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
    <div class="form-row">
      <button class="btn primary" type="submit">Sign in</button>
      <span class="form-links">
        <a href="<?= e(omnione_url('/forgot.php')) ?>">Forgot password?</a> ·
        <a href="<?= e(omnione_url('/register.php')) ?>">Create an Omni account</a>
      </span>
    </div>
  </form>
</section>
<?php page_foot();
