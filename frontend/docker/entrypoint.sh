#!/bin/sh
set -eu

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__MAPGEO_CONFIG__ = {
  API_BASE_URL: "${API_BASE_URL:-/api}",
  GOOGLE_CLIENT_ID: "${GOOGLE_CLIENT_ID:-}",
  USE_REFRESH_COOKIE: ${USE_REFRESH_COOKIE:-true}
};
EOF
