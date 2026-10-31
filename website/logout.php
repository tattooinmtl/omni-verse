<?php
require __DIR__ . '/_private/page.php';

// POST only, with the CSRF token: a link or image elsewhere cannot sign anyone out.
if (is_post()) {
    csrf_verify();
    sign_out();
}
redirect('/');
