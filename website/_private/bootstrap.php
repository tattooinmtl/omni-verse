<?php
// Loaded first by every Omniverse page and API call.

declare(strict_types=1);

define('OMV_PRIVATE', __DIR__);
define('OMV_VERSION', '1.0.0');

$omvConfigFile = getenv('OMNIVERSE_CONFIG') ?: (__DIR__ . '/config.php');
if (!is_file($omvConfigFile)) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    exit("The Omniverse site is not configured yet.\nCopy _private/config.example.php to _private/config.php and fill it in.\n");
}
// OmniOne's library reads its settings from OMNI_CONFIG; ours has the same shape.
$GLOBALS['OMNI_CONFIG'] = require $omvConfigFile;

$omvProd = ($GLOBALS['OMNI_CONFIG']['env'] ?? 'production') === 'production';
error_reporting(E_ALL);
ini_set('display_errors', $omvProd ? '0' : '1');
ini_set('log_errors', '1');
@mkdir(__DIR__ . '/logs', 0700);
ini_set('error_log', __DIR__ . '/logs/php-errors.log');
date_default_timezone_set('UTC');

// Sign-in, sessions, CSRF, rate limits and the device-code helpers are
// OmniOne's, so accounts behave identically on every Omni site.
$omvLib = rtrim((string) ($GLOBALS['OMNI_CONFIG']['omnione_lib'] ?? ''), '/');
foreach (['core', 'security', 'auth', 'connect'] as $f) require "$omvLib/$f.php";
require __DIR__ . '/lib/omniverse.php';

/* Start a page: headers, session, a friendly error page. */
function omv_boot_page(): void
{
    security_headers();
    session_boot();
    set_exception_handler(function (Throwable $e) {
        error_log('[omniverse] ' . $e);
        if (!headers_sent()) http_response_code(500);
        echo config('env') === 'production'
            ? '<!doctype html><meta charset="utf-8"><title>Error</title><p style="font-family:sans-serif">Something went wrong on our side. Please try again in a moment.</p>'
            : '<pre>' . e((string) $e) . '</pre>';
    });
}
