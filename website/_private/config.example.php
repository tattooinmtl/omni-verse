<?php
// Omniverse website — private configuration.
//
// Copy to `config.php` in this folder, on the server only, and fill it in.
// `_private/` is locked by its .htaccess. Never commit config.php.
//
// Accounts are shared with OmniOne: same database, same `users` and
// `omni_accounts` tables, and the sign-in code is OmniOne's own library,
// loaded from `omnione_lib`. So one email and password work on every Omni site.

return [
    'site_url' => 'https://omniverse.globalwarningnetworks.com',
    'env' => 'production',

    // OmniOne's site, for creating an account, verifying email and resetting a password.
    'omnione_url' => 'https://omnione.globalwarningnetworks.com',
    // OmniOne's PHP library on this server (core, security, auth, connect).
    'omnione_lib' => '/home/<cpanel-user>/omnione.globalwarningnetworks.com/_private/lib',

    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => '<cpanel-user>_viteReact',
        'user' => 'CHANGE_ME',
        'pass' => 'CHANGE_ME',
    ],

    // Only true behind a proxy/CDN that sets X-Forwarded-For.
    'trust_proxy' => false,
];
