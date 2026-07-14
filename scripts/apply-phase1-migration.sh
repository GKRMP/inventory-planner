#!/usr/bin/env bash
#
# One-time setup: adopts Prisma migration history for a database that has
# so far only been managed with `prisma db push` (this project's Session
# table), then generates + applies the Phase 1 sync-foundation migration
# (Supplier/Product/Variant/VariantSource/SyncState).
#
# This does NOT run a local Postgres — DATABASE_URL is a connection string
# and every command below talks to that remote database over the network,
# same as opening `psql "$DATABASE_URL"` would.
#
# Usage:
#   ./scripts/apply-phase1-migration.sh "postgres://user:pass@host/db"
#
# Or export it first:
#   export DATABASE_URL="postgres://user:pass@host/db"
#   ./scripts/apply-phase1-migration.sh
#
# Safe to re-run: each step checks whether it already happened and skips if so.

set -euo pipefail

DATABASE_URL="${1:-${DATABASE_URL:-}}"

if [ -z "$DATABASE_URL" ]; then
  echo "Usage: $0 <DATABASE_URL>" >&2
  echo "  or:  export DATABASE_URL=... && $0" >&2
  exit 1
fi

if [ ! -f "prisma/schema.prisma" ]; then
  echo "Run this from the repo root (prisma/schema.prisma not found here)." >&2
  exit 1
fi

export DATABASE_URL

echo "== Target database =="
# Print host/db only, never the password.
echo "$DATABASE_URL" | sed -E 's#(postgres(ql)?://[^:]+):[^@]+@#\1:****@#'
echo
read -r -p "This will run migrations against the database above. Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

BASELINE_DIR="prisma/migrations/0000_baseline"
PHASE1_NAME="phase1_sync_foundation"

echo
echo "== Step 1/4: baseline existing schema (Session table, from db push) =="
if [ -d "prisma/migrations" ] && [ "$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l)" -gt 0 ]; then
  echo "prisma/migrations already has content — skipping baseline (assuming this already ran)."
else
  mkdir -p "$BASELINE_DIR"
  npx prisma migrate diff \
    --from-empty \
    --to-url "$DATABASE_URL" \
    --script > "$BASELINE_DIR/migration.sql"
  echo "Wrote $BASELINE_DIR/migration.sql (describes what's already live — not executed, just recorded)."
  npx prisma migrate resolve --applied 0000_baseline
  echo "Marked 0000_baseline as applied."
fi

echo
echo "== Step 2/4: check for drift before generating the new migration =="
if npx prisma migrate status 2>&1 | grep -qi "drift"; then
  echo "Drift detected between migration history and the live database." >&2
  echo "Stopping here — investigate with 'npx prisma migrate status' before continuing." >&2
  exit 1
fi

echo
echo "== Step 3/4: generate the Phase 1 migration (Supplier/Product/Variant/VariantSource/SyncState) =="
EXISTING_PHASE1_DIR=$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -name "*_${PHASE1_NAME}" | head -n1 || true)
if [ -n "$EXISTING_PHASE1_DIR" ]; then
  echo "Found existing $EXISTING_PHASE1_DIR — skipping generation, will just apply it."
else
  TIMESTAMP="$(date -u +%Y%m%d%H%M%S)"
  NEW_DIR="prisma/migrations/${TIMESTAMP}_${PHASE1_NAME}"
  mkdir -p "$NEW_DIR"
  npx prisma migrate diff \
    --from-url "$DATABASE_URL" \
    --to-schema-datamodel prisma/schema.prisma \
    --script > "$NEW_DIR/migration.sql"
  echo "Wrote $NEW_DIR/migration.sql"
  echo
  echo "--- Review before applying ---"
  cat "$NEW_DIR/migration.sql"
  echo "--- end of migration.sql ---"
  echo
  read -r -p "Apply this migration now? [y/N] " apply_confirm
  if [[ ! "$apply_confirm" =~ ^[Yy]$ ]]; then
    echo "Migration file written but not applied. Run 'npx prisma migrate deploy' when ready."
    exit 0
  fi
fi

echo
echo "== Step 4/4: apply pending migrations =="
npx prisma migrate deploy

echo
echo "== Done — final status =="
npx prisma migrate status

cat <<'EOF'

Next steps:
  1. Commit the new prisma/migrations/ folder to git and push.
  2. Merge the phase-1 PR and let Render redeploy.
  3. Run `shopify app deploy` to register the new webhook subscriptions
     (expect a merchant re-auth prompt).
  4. Trigger POST /api/sync once (embedded admin, or with x-sync-secret)
     to run the first backfill, then check Variant/Supplier row counts
     against Shopify admin.
EOF
