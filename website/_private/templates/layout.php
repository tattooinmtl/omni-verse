<?php
// The frame around every Omniverse PHP page: the same header and look as the
// landing page, on a static grid instead of the 3D city. Text comes in the
// visitor's language (tr(), see bootstrap.php); the FR | EN switch reloads.

function page_head(string $title): void
{
    $u = current_user();
    $v = OMV_VERSION;
    ?><!doctype html>
<html lang="<?= omv_lang() ?>" data-gwn-server>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= e($title) ?></title>
<meta name="theme-color" content="#01050a">
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=VT323&display=swap">
<link rel="stylesheet" href="/style.css?v=<?= $v ?>">
<link rel="stylesheet" href="/pages.css?v=<?= $v ?>">
</head>
<body class="page">
<header class="top">
  <a class="logo" href="/" aria-label="<?= e(tr('Omniverse home', 'Accueil Omniverse')) ?>"><span class="logo-mark" aria-hidden="true"></span>OMNIVERSE</a>
  <nav aria-label="Site">
    <a href="/"><?= e(tr('The city', 'La ville')) ?></a>
    <?php if ($u): ?>
      <a href="/account.php" class="nav-cta"><?= e($u['name'] ?: tr('Account', 'Compte')) ?></a>
    <?php else: ?>
      <a href="/login.php" class="nav-cta"><?= e(tr('Sign in', 'Connexion')) ?></a>
    <?php endif; ?>
    <span class="nav-lang" data-gwn-lang-switch></span>
  </nav>
</header>
<main class="page-main">
<?php
}

function page_foot(): void
{
    ?>
</main>
<footer class="foot"><p><span class="logo-mark" aria-hidden="true"></span> <?= e(tr('OMNIVERSE · one account for every Omni product', 'OMNIVERSE · un seul compte pour tous les produits Omni')) ?></p>
  <p class="privacy"><?= tr(
      '<a href="/legal/">Legal</a> · <a href="/legal/#eula">EULA &amp; Terms</a> · <a href="/legal/#privacy">Privacy &amp; Cookies</a> · Experimental AI software, used at your own risk.',
      '<a href="/legal/">Mentions légales</a> · <a href="/legal/#eula">CLUF et conditions</a> · <a href="/legal/#privacy">Confidentialité et témoins</a> · Logiciel d’IA expérimental, utilisé à vos propres risques.'
  ) ?></p></footer>
<script src="/legal/gwn-lang.js?v=1"></script>
<script src="/legal/gwn-consent.js?v=2026-10-31b"></script>
</body>
</html>
<?php
}

/* Errors come from OmniOne's shared sign-in library in English; the ones a
 * visitor can see here get a French version. */
const OMV_ERRORS_FR = [
    'That email and password don’t match. If you signed up with Google, use “Forgot password” to set one.' =>
        'Ce courriel et ce mot de passe ne correspondent pas. Si vous vous êtes inscrit avec Google, utilisez « Mot de passe oublié » pour en créer un.',
    'Too many sign-in attempts. Wait 15 minutes and try again.' =>
        'Trop de tentatives de connexion. Attendez 15 minutes et réessayez.',
    'This account is disabled.' => 'Ce compte est désactivé.',
    'Too many attempts. Try again in an hour.' => 'Trop de tentatives. Réessayez dans une heure.',
    'That code has expired or was already used. Start again from the Omniverse app.' =>
        'Ce code a expiré ou a déjà été utilisé. Recommencez depuis l’application Omniverse.',
];

function form_error(?string $err): string
{
    if (!$err) return '';
    if (omv_lang() === 'fr' && isset(OMV_ERRORS_FR[$err])) $err = OMV_ERRORS_FR[$err];
    return '<div class="flash flash--error" role="alert">' . e($err) . '</div>';
}
