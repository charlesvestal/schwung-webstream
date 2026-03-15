# Samplette Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add samplette.io as a music discovery provider in the webstream module, with genre/key/tempo filtering and auto-advance playback.

**Architecture:** The Python daemon gets samplette session management and three new commands (INIT/FILTER/SEARCH). The C plugin gets a new provider constant, extended search results with metadata fields, auto-advance on EOF, and a next-track trigger. The UI gets a samplette-specific menu with filter submenus and now-playing info.

**Tech Stack:** Python 3 (requests via urllib), C (v2 plugin API), QuickJS (UI)

---

### Task 1: Daemon - Samplette Session & Commands

**Files:**
- Modify: `src/bin/yt_dlp_daemon.py`

**What to build:**
Add samplette session state (requests.Session equivalent using urllib), CSRF token extraction, and three commands: SAMPLETTE_INIT, SAMPLETTE_FILTER, SAMPLETTE_SEARCH. Use urllib (already imported) rather than adding a requests dependency.

**Key decisions:**
- Samplette results return via the existing SEARCH_BEGIN/SEARCH_ITEM/SEARCH_END protocol but with extra tab-delimited fields for metadata
- Session auto-inits on first SAMPLETTE_SEARCH if not yet initialized
- Exclude list caps at 200 IDs, resets on SAMPLETTE_FILTER

---

### Task 2: C Plugin - Provider & Extended Search Results

**Files:**
- Modify: `src/dsp/yt_stream_plugin.c`

**What to build:**
- Add `samplette` to normalize_provider_value
- Add metadata fields to search_result_t (key, scale, tempo, genre, style, country, year)
- In run_search_command_daemon: when provider is samplette, send SAMPLETTE_SEARCH instead of SEARCH, parse extended fields from SEARCH_ITEM
- Add `samplette_result_index` and `samplette_auto_advance` to yt_instance_t
- In v2_render_block: when stream_eof and provider is samplette, auto-advance to next result
- Add `next_track_step` param handler in v2_set_param
- Expose metadata via get_param: `search_result_key_N`, `search_result_genre_N`, etc.
- Samplette URLs resolve via existing youtube resolve path

---

### Task 3: UI - Samplette Provider & Filter Menus

**Files:**
- Modify: `src/ui.js`

**What to build:**
- Add samplette to PROVIDERS and PROVIDER_TAGS
- When provider is samplette, build different root menu: Shuffle, Next Track, Filters submenu, Now Playing
- Filters submenu with Genre, Key, Tempo pickers
- Genre list: hardcoded from samplette's genres_lov (14 items)
- Key picker: C through B + All
- Tempo picker: All / Slow 60-90 / Med 90-120 / Fast 120-150
- Filter changes set params that trigger SAMPLETTE_FILTER + SAMPLETTE_SEARCH
- Now Playing shows title + metadata from current result
- Shuffle = trigger search + auto-play first result
- Next Track = set next_track_step param

---

### Task 4: Commit & Test

**What to do:**
- Verify daemon can be tested standalone with `echo "SAMPLETTE_INIT" | python3 src/bin/yt_dlp_daemon.py`
- Commit all changes
