#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSP_C="$ROOT_DIR/src/dsp/yt_stream_plugin.c"
UI_JS="$ROOT_DIR/src/browser.js"
DAEMON_PY="$ROOT_DIR/src/bin/yt_dlp_daemon.py"

fail=0

# Daemon has CrateDigSession and command handlers
for fn in CrateDigSession cratedig_init cratedig_filter cratedig_search; do
  if ! rg -q "$fn" "$DAEMON_PY"; then
    echo "FAIL: daemon should implement ${fn}"
    fail=1
  fi
done

# Daemon handles CRATEDIG commands
for cmd in CRATEDIG_INIT CRATEDIG_FILTER CRATEDIG_SEARCH; do
  if ! rg -Fq "\"$cmd\"" "$DAEMON_PY"; then
    echo "FAIL: daemon should handle ${cmd} command"
    fail=1
  fi
done

# C plugin has cratedig provider normalization
if ! rg -Fq '"cratedig"' "$DSP_C"; then
  echo "FAIL: C plugin should normalize cratedig provider"
  fail=1
fi

# C plugin has renamed fields
for field in cratedig_result_index cratedig_auto_advance cratedig_pending_filter; do
  if ! rg -q "$field" "$DSP_C"; then
    echo "FAIL: C plugin should have field ${field}"
    fail=1
  fi
done

# The browse page offers Crate Dig and its four filters (tables + picker);
# what they SEND is driven in tests/test_browse_page.sh.
if ! rg -q "'cratedig'" "$UI_JS"; then
  echo "FAIL: browser.js should expose cratedig provider"
  fail=1
fi
for table in CRATEDIG_GENRES CRATEDIG_STYLES CRATEDIG_DECADES CRATEDIG_COUNTRIES; do
  if ! rg -q "const ${table} =" "$UI_JS"; then
    echo "FAIL: browser.js should define ${table}"
    fail=1
  fi
done
if ! rg -q "kind: 'dig_pick'" "$UI_JS"; then
  echo "FAIL: browser.js should implement the filter pickers"
  fail=1
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "PASS: Crate Dig wiring is present across all layers"
