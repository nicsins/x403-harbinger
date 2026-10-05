#!/bin/sh
# Harbinger pump trigger (big-kitty). Secrets come from EnvironmentFile only.
# The bearer header is fed to curl on stdin (-K -) so it never shows in argv / ps.
set -eu
: "${CRON_SECRET:?CRON_SECRET missing from EnvironmentFile}"
: "${PUMP_URL:?PUMP_URL not set}"
printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" |
  /usr/bin/curl -fsS --max-time 50 -K - -w ' http=%{http_code} t=%{time_total}s\n' "$PUMP_URL"
