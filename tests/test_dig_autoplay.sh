#!/usr/bin/env bash
# Dig! plays what it finds. The old full-screen UI did this from its own tick;
# the browse page cannot (its status arrives in drawPage, which may not set
# params), so v0.5.0 silently dropped it. It lives in the DSP now -- pinned
# here so a UI rewrite cannot drop it again.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSP_C="$ROOT_DIR/src/dsp/yt_stream_plugin.c"
fail=0

body() {  # print the body of a top-level C function, by name
  awk -v name="$1" '
    $0 ~ "^static [a-z_* ]+" name "\\(.*\\{$" { on = 1 }
    on { print }
    on && /^}/ { exit }
  ' "$DSP_C"
}

handler() {  # print one set_param key's branch
  body v2_set_param | awk -v key="$1" '
    index($0, "strcmp(key, \"" key "\") == 0") { on = 1 }
    on { print }
    on && /^    }$/ { exit }
  '
}

handler cratedig_filter | grep -q 'cratedig_autoplay_armed = true' \
  || { echo "FAIL: Dig! (cratedig_filter) must arm autoplay"; fail=1; }

body cancel_dig_autoplay | grep -q 'cratedig_autoplay_armed = false' \
  || { echo "FAIL: cancel_dig_autoplay must disarm"; fail=1; }
handler stream_url | grep -q 'cancel_dig_autoplay(inst)' \
  || { echo "FAIL: an explicit stream_url pick must disarm an in-flight Dig!"; fail=1; }
body stop_everything | grep -q 'cancel_dig_autoplay(inst)' \
  || { echo "FAIL: Stop must disarm an in-flight Dig!"; fail=1; }

search="$(body search_thread_main)"
grep -q 'cratedig_autoplay_ready, 1' <<<"$search" \
  || { echo "FAIL: a finished Crate Dig search must mark autoplay ready"; fail=1; }
grep -q 'strcmp(provider, "cratedig") == 0' <<<"$search" \
  || { echo "FAIL: only a Crate Dig answer may autoplay"; fail=1; }
# The search thread must not drive the stream itself (render races).
if grep -qE 'play_search_result|stop_stream|restart_stream_from_beginning' <<<"$search"; then
  echo "FAIL: search thread must not touch the stream; render consumes the flag"
  fail=1
fi

render="$(body v2_render_block)"
# Consumed BEFORE the empty-stream_url early return, or a first Dig! with
# nothing playing would never start.
consume=$(grep -n '__atomic_exchange_n(&inst->cratedig_autoplay_ready' <<<"$render" | head -1 | cut -d: -f1)
early=$(grep -n "stream_url\[0\] == '\\\\0'" <<<"$render" | head -1 | cut -d: -f1)
if [[ -z "$consume" ]]; then
  echo "FAIL: render_block must consume cratedig_autoplay_ready"; fail=1
elif [[ -z "$early" || "$consume" -gt "$early" ]]; then
  echo "FAIL: autoplay must be consumed before the empty-stream early return"; fail=1
fi

[[ "$fail" -eq 0 ]] || exit 1
echo "PASS: Dig! autoplays its first result"
