#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSP_C="$ROOT_DIR/src/dsp/yt_stream_plugin.c"
UI_JS="$ROOT_DIR/src/browser.js"
DAEMON_PY="$ROOT_DIR/src/bin/yt_dlp_daemon.py"

fail=0

for provider in youtube freesound archive soundcloud; do
  if ! rg -q "'${provider}'" "$UI_JS"; then
    echo "FAIL: browser.js should expose provider '${provider}'"
    fail=1
  fi
done
# The ORDER (search_provider before search_query, stream_provider before
# stream_url) is driven in tests/test_browse_page.sh, not grepped.

if ! rg -Fq '"SEARCH\t%s\t%d\t%s\n"' "$DSP_C"; then
  echo "FAIL: DSP search request should include provider"
  fail=1
fi

if ! rg -Fq '"RESOLVE\t%s\t%s\n"' "$DSP_C"; then
  echo "FAIL: DSP resolve request should include provider"
  fail=1
fi

if ! rg -q 'search_provider' "$DSP_C"; then
  echo "FAIL: DSP should expose search_provider param"
  fail=1
fi

if ! rg -q 'stream_provider' "$DSP_C"; then
  echo "FAIL: DSP should expose stream_provider param"
  fail=1
fi

for fn in search_request_freesound resolve_request_freesound search_request_archive resolve_request_archive; do
  if ! rg -q "def ${fn}\\(" "$DAEMON_PY"; then
    echo "FAIL: daemon should implement ${fn}()"
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "PASS: provider search/resolve wiring is present"
