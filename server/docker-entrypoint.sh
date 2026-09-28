#!/bin/sh
# Applies pending migrations (a no-op when there are none), optionally seeds
# (the seed is idempotent), then runs the API in the foreground.
set -e
node node_modules/prisma/build/index.js migrate deploy
if [ "${SEED_ON_START:-false}" = "true" ]; then
  node dist/db/seed.js
fi
exec node dist/index.js
