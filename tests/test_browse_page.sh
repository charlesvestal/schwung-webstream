#!/usr/bin/env bash
# The browse page (src/browser.js), DRIVEN: it is a canvas page, so this runs
# the real script with std/os stubbed and a fake host ctx, and checks what the
# user does -- search, play a result, history, Crate Dig -- by the params it
# writes, in the order the DSP needs them.
set -euo pipefail
cd "$(dirname "$0")/.."
node --input-type=module -e '
import fs from "node:fs";
import vm from "node:vm";
const src = fs.readFileSync("src/browser.js", "utf8")
  .replace("import * as std from \x27std\x27;", "const std = globalThis.__std;")
  .replace("import * as os from \x27os\x27;", "const os = globalThis.__os;");
let fails = 0;
const ok = (c, m) => { if (!c) { console.log("FAIL: " + m); fails++; } };
function load(files = {}) {
  const g = { console, Math, Date, JSON, String, Number, Array, Object,
    __std: { loadFile: (p) => (p in files ? files[p] : null), open: (p) => ({ puts: (t) => { files[p] = t; }, close() {} }) },
    __os: { mkdir() {}, rename: (a, b) => { files[b] = files[a]; delete files[a]; return 0; } } };
  g.globalThis = g; vm.createContext(g); vm.runInContext(src, g);
  return { ov: g.canvas_overlay, files };
}
const results = { st: "stopped", pv: "youtube", ss: "done", n: 2, pi: -1, dl: "idle",
  r: [{ t: "First", p: "youtube", d: "1:00" }, { t: "Second", p: "soundcloud", d: "2:00" }] };
function host(params) {
  const sets = []; const state = {};
  const ctx = { state, getParam: (k) => (k in params ? params[k] : ""), setParam: (k, v) => { sets.push([k, String(v)]); return true; },
                openTextEntry: (o) => { sets.push(["KB", o.title, o.initial]); return true; }, openFileInTool: () => true };
  return { ctx, sets, state };
}
const draw = (ov, h, us) => ov.drawPage({ width: 128, height: 45, fillRect() {}, print() {} },
                                       { state: h.state, values: { ui_status: JSON.stringify(us) }, nowMs: Date.now() });
const jog = (ov, h, n) => { for (let i = 0; i < Math.abs(n); i++) ov.onMidi(h.ctx, { data: [176, 14, n > 0 ? 1 : 127] }); };
const click = (ov, h) => ov.onMidi(h.ctx, { data: [176, 3, 127] });
const enter = (ov, h) => jog(ov, h, 1) /* the first gesture proves entry and moves nothing */;
const idx = (sets, k) => sets.findIndex((s) => s[0] === k);

/* search: an EMPTY prompt, then provider BEFORE query, and remembered */
{
  const { ov, files } = load(); const h = host({ ui_status: JSON.stringify(results) });
  draw(ov, h, results); enter(ov, h); click(ov, h);              /* row 0: Search [YT] */
  ok(h.sets[0] && h.sets[0][0] === "KB" && h.sets[0][2] === "", "Search opens the keyboard with empty text");
  ok(/\[YT\]/.test(h.sets[0][1]), "the keyboard is titled with the provider tag");
  ov.onTextEntry(h.ctx, { text: " aphex ", cancelled: false });
  ok(idx(h.sets, "search_provider") >= 0 && idx(h.sets, "search_provider") < idx(h.sets, "search_query"),
     "search_provider is set before search_query");
  ok(h.sets.some((s) => s[0] === "search_query" && s[1] === "aphex"), "the query is trimmed");
  const hist = JSON.parse(files["/data/UserData/schwung/config/webstream_search_history.json"] || "[]");
  ok(hist[0] && hist[0].query === "aphex" && hist[0].provider === "youtube", "the search is saved to history");
  const before = h.sets.length; ov.onTextEntry(h.ctx, { text: null, cancelled: true });
  ok(h.sets.length === before, "a cancelled keyboard searches nothing");
}
/* a result plays with stream_provider BEFORE stream_url, from its own provider */
{
  const { ov } = load();
  const h = host({ ui_status: JSON.stringify(results), search_result_url_1: "https://sc/2", search_result_provider_1: "soundcloud" });
  draw(ov, h, results); enter(ov, h); jog(ov, h, 5); click(ov, h);   /* rows: Search, Provider, Prev, Fav, First, Second */
  ok(idx(h.sets, "stream_provider") >= 0 && idx(h.sets, "stream_provider") < idx(h.sets, "stream_url"),
     "stream_provider is set before stream_url");
  ok(h.sets.some((s) => s[0] === "stream_url" && s[1] === "https://sc/2"), "the clicked result is the one that plays");
  ok(h.sets.some((s) => s[0] === "stream_provider" && s[1] === "soundcloud"), "with its own provider");
}
/* history: reloaded from disk when opened; legacy file still read */
{
  const { ov } = load({ "/data/UserData/schwung/webstream_search_history.json": JSON.stringify(["old query"]) });
  const h = host({ ui_status: JSON.stringify(results) });
  draw(ov, h, results); enter(ov, h); jog(ov, h, 2); click(ov, h); click(ov, h);  /* Previous searches -> first */
  ok(h.sets.some((s) => s[0] === "search_query" && s[1] === "old query"), "a legacy history entry is offered and searchable");
}
/* Crate Dig: picking it sets the provider; Dig sends the saved filter */
{
  const { ov, files } = load({ "/data/UserData/schwung/config/webstream_cratedig_filter.json": JSON.stringify({ genre: "Jazz" }) });
  const h = host({ ui_status: JSON.stringify(results) });
  draw(ov, h, results); enter(ov, h); jog(ov, h, 1); click(ov, h);  /* Provider */
  jog(ov, h, 4); click(ov, h);                                      /* Crate Dig */
  ok(h.sets.some((s) => s[0] === "search_provider" && s[1] === "cratedig"), "Crate Dig sets the provider");
  click(ov, h);                                                     /* root row 0 is now Dig! */
  const f = h.sets.find((s) => s[0] === "cratedig_filter");
  ok(f && JSON.parse(f[1]).genre === "Jazz", "Dig sends the saved filter");
  ok(h.sets.some((s) => s[0] === "cratedig_auto_advance" && s[1] === "1"), "and auto-advance");
}
/* Back goes up a level, then out */
{
  const { ov } = load(); const h = host({ ui_status: JSON.stringify(results) });
  draw(ov, h, results); enter(ov, h); jog(ov, h, 1); click(ov, h);
  ok(ov.handleBack(h.ctx) === true, "Back from a sub-level stays inside");
  ok(ov.handleBack(h.ctx) === false, "Back at the top leaves the page");
}
/* the highlight stays on the clicked result when Now playing appears above it */
{
  const { ov } = load();
  const h = host({ ui_status: JSON.stringify(results), search_result_url_0: "u0", search_result_provider_0: "youtube" });
  draw(ov, h, results); enter(ov, h); jog(ov, h, 4); click(ov, h);   /* row 4 = First */
  const playingNow = Object.assign({}, results, { st: "buffering", pi: 0 });
  h.ctx.getParam = (k) => (k === "ui_status" ? JSON.stringify(playingNow) : "");
  draw(ov, h, playingNow);
  const lvl = h.state.stack[h.state.stack.length - 1];
  ok(lvl.curId === "r0" && lvl.cursor === 5, "the cursor follows the result down when Now playing is inserted");
}
if (fails) { console.log(fails + " failure(s)"); process.exit(1); }
console.log("PASS: browse page");
'
