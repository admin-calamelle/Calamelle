#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.12+ is required."
  exit 1
fi
MAJOR="$(node -p 'process.versions.node.split(`.`)[0]')"
if [ "$MAJOR" -lt 22 ]; then
  echo "Node.js 22.12+ is required."
  exit 1
fi
if [ ! -d node_modules ]; then
  npm install
fi
npm run dev
