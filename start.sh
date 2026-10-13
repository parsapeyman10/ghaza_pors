#!/usr/bin/env sh
# اجراکنندهٔ پرتابل برای مک/لینوکس
cd "$(dirname "$0")" || exit 1
if [ -x ./GhazaPors ];      then exec ./GhazaPors "$@";      fi
if [ -x ./dist/GhazaPors ]; then exec ./dist/GhazaPors "$@"; fi
if command -v node >/dev/null 2>&1; then exec node server/main.js "$@"; fi
echo "neither ./GhazaPors nor node found — see README.md"
exit 1
