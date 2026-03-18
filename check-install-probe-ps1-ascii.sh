#!/usr/bin/env sh
set -eu

target="${1:-install_probe.ps1}"

if [ ! -f "$target" ]; then
  echo "ERROR: file not found: $target" >&2
  exit 1
fi

if perl -ne 'exit 1 if /[^\x00-\x7F]/; END { exit 0 }' "$target"; then
  echo "OK: $target contains ASCII only"
else
  echo "ERROR: $target contains non-ASCII characters" >&2
  perl -ne 'print $. . ":" . $_ if /[^\x00-\x7F]/' "$target" >&2
  exit 1
fi
