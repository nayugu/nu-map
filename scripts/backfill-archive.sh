#!/usr/bin/env bash
#
# backfill-archive.sh — scrape every browsable past edition of the catalog.
#
# Requirements are locked to the edition a student entered under, and NU Map
# held only the live one. catalog.northeastern.edu/archive/ publishes complete
# browsable catalogs back to 2019-2020, so this fills in the six editions
# behind the live one: seven in total, which covers any enrolled student
# including a six-year co-op path.
#
# ── Why newest-first ──────────────────────────────────────────────────
#
# The discovery-floor rail baselines an archive run against the NEAREST
# committed edition (scrape-majors.js → priorEditionCount). The catalog grows,
# so 2020 really does publish fewer programs than 2026 and measuring across
# seven years would fire the rail on a perfectly good run. Walking backwards
# one year at a time gives every run a neighbour to be measured against, where
# a shortfall actually means something.
#
# ── Why it stops on the first failure ─────────────────────────────────
#
# A refusal means the rails saw something that looks like breakage, and every
# older edition would then be measured against a baseline that never landed.
# Carrying on would spend an hour of polite fetching after the point where the
# answer stopped being trustworthy. Re-running is cheap once the page cache is
# warm, so stopping costs almost nothing.
#
# Usage:
#   scripts/backfill-archive.sh                 # all six, undergrad + graduate
#   CATALOG_HTML_CACHE=.cache/catalog scripts/backfill-archive.sh
#
# The cache is a development affordance only — it must never be set in CI,
# where a run has to see the live archive.

set -uo pipefail
cd "$(dirname "$0")/.."

EDITIONS=(2024-2025 2023-2024 2022-2023 2021-2022 2020-2021 2019-2020)
LOGDIR="${ARCHIVE_LOG_DIR:-.cache/archive-logs}"
mkdir -p "$LOGDIR"

echo "Backfilling ${#EDITIONS[@]} editions, newest first. Logs → $LOGDIR/"
echo

for ed in "${EDITIONS[@]}"; do
  for scraper in scrape-majors scrape-grad-majors; do
    log="$LOGDIR/$ed-$scraper.log"
    printf '  %s  %-18s ' "$ed" "$scraper"

    if ! node "scripts/$scraper.js" --edition "$ed" --write > "$log" 2>&1; then
      echo "FAILED"
      echo
      echo "Stopped at $ed / $scraper. Every older edition would have been"
      echo "measured against a baseline that never landed, so nothing further"
      echo "was attempted. Tail of the log:"
      echo
      tail -20 "$log"
      exit 1
    fi

    # One line per run, pulled from the scraper's own summary rather than
    # recomputed here — so what this prints is what actually got written.
    grep -E '^Archive|^Results:' "$log" | tr '\n' ' ' | sed 's/  */ /g'
    echo
  done
done

echo
echo "Done. Manifest:"
node -e "
const m = require('./data/northeastern/programs/archive/manifest.json');
for (const [year, e] of Object.entries(m.editions)) {
  const f = t => e[t] ? \`\${String(e[t].programs).padStart(4)} programs, \${String(e[t].plans).padStart(3)} plans\` : '            (none)';
  console.log(\`  \${year}  \${e.label}   ug: \${f('undergraduate')}   grad: \${f('graduate')}\`);
}
"
