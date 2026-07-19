#!/bin/sh
set -eu

for candidate in \
  "${PYTHON_WITH_OPENAI:-}" \
  "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3" \
  "/usr/bin/python3" \
  "$(command -v python3 2>/dev/null || true)"
do
  [ -n "$candidate" ] || continue
  [ -x "$candidate" ] || continue
  if "$candidate" -c 'import openai' >/dev/null 2>&1; then
    exec "$candidate" "$@"
  fi
done

echo "No Python runtime with the openai package is available." >&2
exit 1
