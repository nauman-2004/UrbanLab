#!/usr/bin/env bash
# Start UrbanLab (agent backend + frontend) from the repo root. Usage: ./dev.sh [live|fake|demo]
cd "$(dirname "$0")/frontend" && exec node scripts/dev.mjs "$@"
