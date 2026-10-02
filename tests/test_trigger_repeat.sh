#!/usr/bin/env bash
# Every press of a knob-grid trigger writes the SAME value ("1" or "trigger"),
# so each one must fire -- not only the first. Compiles the real
# parse_trigger_value out of the DSP source and drives it.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
{
  echo '#include <stdbool.h>'; echo '#include <stdlib.h>'; echo '#include <string.h>'; echo '#include <stdio.h>'
  awk '/^static bool parse_trigger_value\(/,/^}/' src/dsp/yt_stream_plugin.c
  cat <<'C'
int main(void) {
    int st = 0, fails = 0;
#define EXPECT(v, want) do { bool got = parse_trigger_value(v, &st); \
    if (got != (want)) { printf("FAIL: \"%s\" -> %d, want %d\n", v, got, want); fails++; } } while (0)
    EXPECT("1", true);  EXPECT("1", true);  EXPECT("1", true);   /* repeated index presses */
    EXPECT("trigger", true); EXPECT("trigger", true);
    EXPECT("idle", false); EXPECT("0", false); EXPECT("off", false);
    EXPECT("2", true); EXPECT("3", true);                         /* a rising legacy counter */
    if (!fails) printf("PASS: every trigger press fires\n");
    return fails ? 1 : 0;
}
C
} > "$tmp/t.c"
cc -o "$tmp/t" "$tmp/t.c" && "$tmp/t"
