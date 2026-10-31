<?php
// The frame around every Omniverse PHP page: the same header and look as the
// landing page, on a static grid instead of the 3D city.

function page_head(string $title): void
{
    $u = current_user();
    $v = OMV_VERSION;
    ?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title><?= e($title) ?></title>
<meta name="theme-color" content="#01050a">
<meta name="robots" content="noindex">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=VT323&display=swap">
<link rel="stylesheet" href="/style.css?v=<?= $v ?>">
<link rel="stylesheet" href="/pages.css?v=<?= $v ?>">
</head>
<body class="page">
<header class="top">
  <a class="logo" href="/" aria-label="Omniverse home"><span class="logo-mark" aria-hidden="true"></span>OMNIVERSE</a>
  <nav aria-label="Site">
    <a href="/">The city</a>
    <?php if ($u): ?>
      <a href="/account.php" class="nav-cta"><?= e($u['name'] ?: 'Account') ?></a>
    <?php else: ?>
      <a href="/login.php" class="nav-cta">Sign in</a>
    <?php endif; ?>
  </nav>
</header>
<main class="page-main">
<?php
}

function page_foot(): void
{
    ?>
</main>
<footer class="foot"><p><span class="logo-mark" aria-hidden="true"></span> OMNIVERSE · one account for every Omni product</p></footer>
</body>
</html>
<?php
}

function form_error(?string $err): string
{
    return $err ? '<div class="flash flash--error" role="alert">' . e($err) . '</div>' : '';
}
