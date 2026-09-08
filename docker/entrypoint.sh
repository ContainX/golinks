#!/bin/sh
# Container entry point. Applies pending migrations when MIGRATE_ON_START=true
# (spec 09 section 3) and then hands off to the command, which is the service by
# default. Keep migrations off in production and run them as a deploy step instead.
set -eu

case "${MIGRATE_ON_START:-false}" in
  true | TRUE | True | 1 | yes | on)
    echo 'golinks: MIGRATE_ON_START is set, applying pending migrations'
    node /app/apps/api/dist/cli.js migrate
    ;;
esac

exec "$@"
