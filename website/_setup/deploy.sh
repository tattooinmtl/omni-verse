#!/usr/bin/env bash
# Upload the website to omniverse.globalwarningnetworks.com over SSH.
#   bash website/_setup/deploy.sh            (needs the "fastcomet" host in ~/.ssh/config)
#
# Uploads only what the server serves: no serve.mjs, no _setup. Never touches
# _private/config.php (created on the server, see README). cPanel's own block
# in .htaccess is kept, and ours goes below it.
set -euo pipefail
HOST="${OMNIVERSE_SSH:-fastcomet}"
DEST="omniverse.globalwarningnetworks.com"
cd "$(dirname "$0")/.."

ssh -o BatchMode=yes "$HOST" "mkdir -p $DEST/js $DEST/api $DEST/_private/lib $DEST/_private/templates"
scp -q -o BatchMode=yes index.html style.css pages.css login.php logout.php connect.php account.php "$HOST:$DEST/"
scp -q -o BatchMode=yes js/*.js "$HOST:$DEST/js/"
scp -q -o BatchMode=yes api/index.php "$HOST:$DEST/api/"
scp -q -o BatchMode=yes _private/.htaccess _private/bootstrap.php _private/page.php _private/config.example.php "$HOST:$DEST/_private/"
scp -q -o BatchMode=yes _private/lib/omniverse.php "$HOST:$DEST/_private/lib/"
scp -q -o BatchMode=yes _private/templates/layout.php "$HOST:$DEST/_private/templates/"
scp -q -o BatchMode=yes .htaccess "$HOST:$DEST/.htaccess.omniverse"

ssh -o BatchMode=yes "$HOST" "cd $DEST && {
  sed -n '/# BEGIN cPanel/,/# END cPanel/p' .htaccess > .htaccess.new 2>/dev/null || true
  echo >> .htaccess.new
  cat .htaccess.omniverse >> .htaccess.new
  mv .htaccess.new .htaccess && rm .htaccess.omniverse
  find . -path ./cgi-bin -prune -o -path ./.well-known -prune -o -type f -name '*.php' -print -o -type f -name '*.js' -print -o -type f -name '*.css' -print -o -type f -name '*.html' -print | xargs chmod 644
  chmod 600 _private/config.php 2>/dev/null || true
  chmod 700 _private
}"
echo "deployed to https://$DEST"
