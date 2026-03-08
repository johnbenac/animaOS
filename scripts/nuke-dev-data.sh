#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${ROOT_DIR}/.anima/dev"

CONFIRM=0
RUN_MIGRATE=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Nuke ANIMA local runtime data (.anima/dev).

Usage:
  scripts/nuke-dev-data.sh --yes [--migrate] [--dry-run]

Options:
  --yes       required confirmation flag to execute deletion
  --migrate   run `bun run db:push` after reset
  --dry-run   print actions without deleting files
  -h, --help  show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes)
      CONFIRM=1
      shift
      ;;
    --migrate)
      RUN_MIGRATE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ${CONFIRM} -ne 1 ]]; then
  echo "Refusing to run without --yes." >&2
  usage
  exit 1
fi

if [[ ${DRY_RUN} -ne 1 ]]; then
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:3031 -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port 3031 is in use. Stop running API/dev processes first." >&2
      exit 1
    fi
  fi
fi

echo "Target data directory: ${DATA_DIR}"

if [[ ${DRY_RUN} -eq 1 ]]; then
  echo "[dry-run] Would remove: ${DATA_DIR}"
  echo "[dry-run] Would recreate: ${DATA_DIR}"
else
  rm -rf "${DATA_DIR}"
  mkdir -p "${DATA_DIR}"
  echo "Data directory reset complete."
fi

if [[ ${RUN_MIGRATE} -eq 1 ]]; then
  if [[ ${DRY_RUN} -eq 1 ]]; then
    echo "[dry-run] Would run: bun run db:push"
  else
    (cd "${ROOT_DIR}" && bun run db:push)
  fi
fi
