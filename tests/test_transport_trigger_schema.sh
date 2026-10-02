#!/usr/bin/env bash
# The UI contract the DSP serves (src/chain_params.json + src/ui_hierarchy.json,
# compiled in by scripts/build.sh): the transport triggers stay idle/trigger
# enums, the browse page leads as an enterable canvas fed by ui_status, and the
# root level carries the transport knobs -- they are what the chain editor maps
# and what the browse page keeps live.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CP="$ROOT_DIR/src/chain_params.json"
UH="$ROOT_DIR/src/ui_hierarchy.json"
MODULE_JSON="$ROOT_DIR/src/module.json"

missing=0
fail() { echo "FAIL: $*"; missing=1; }

if jq -e '.capabilities.chain_params or .capabilities.ui_hierarchy or .ui_chain' "$MODULE_JSON" >/dev/null; then
  fail "module.json must not carry chain_params/ui_hierarchy/ui_chain: the DSP serves the contract"
fi

for key in play_pause_step rewind_15_step forward_15_step stop_step restart_step; do
  type_val="$(jq -r --arg key "$key" '.[] | select(.key == $key) | .type // empty' "$CP")"
  [[ "$type_val" == "enum" ]] || fail "$key expected type=enum, got '${type_val:-<missing>}'"
  options="$(jq -r --arg key "$key" '.[] | select(.key == $key) | (if (.options | type) == "array" then (.options | join(",")) else empty end)' "$CP")"
  [[ "$options" == "idle,trigger" ]] || fail "$key expected options=idle,trigger, got '${options:-<missing>}'"
done

expected_order="browse,play_pause_step,rewind_15_step,forward_15_step,gain,stop_step,restart_step"
actual_order="$(jq -r '[.[].key] | join(",")' "$CP")"
[[ "$actual_order" == "$expected_order" ]] || fail "chain_params order: expected $expected_order, got $actual_order"

jq -e '.[] | select(.key == "browse") | .type == "canvas" and .as_page == true and .enterable == true
       and .page_first == true and .canvas_script == "browser.js" and (.extra_keys == ["ui_status"])' "$CP" >/dev/null \
  || fail "browse must be an as_page, enterable, page_first canvas (browser.js) fed by ui_status"

knobs="$(jq -r '.levels.root.knobs | join(",")' "$UH")"
[[ "$knobs" == "play_pause_step,rewind_15_step,forward_15_step,gain,stop_step,restart_step" ]] \
  || fail "root knobs: got $knobs"
[[ "$(jq -r '.levels.root.params[0]' "$UH")" == "browse" ]] || fail "browse must be the first root param"
[[ -f "$ROOT_DIR/src/browser.js" ]] || fail "src/browser.js missing"

exit "$missing"
