# Crate Dig: Discogs-Powered Random Music Discovery

## Overview

Add a "Crate Dig" provider to webstream that discovers random music via the Discogs API and plays it through the existing YouTube pipeline. User picks genre/style/decade/country filters, hits Shuffle, and hears random tracks from Discogs' 19M+ release catalog.

## Data Flow

```
User picks filters (Genre: Funk / Soul, Style: P-Funk, Decade: 1970s)
         ↓
Daemon: GET api.discogs.com/database/search
        ?genre=Funk+/+Soul&style=P-Funk&year=1970-1979&type=release&per_page=1
         ↓
Response: pagination.pages = N
         ↓
Daemon: pick random page (1..min(N, 10000))
        GET same query with &page={random}&per_page=5
         ↓
Response: release summaries with IDs
         ↓
Daemon: GET api.discogs.com/releases/{id}
         ↓
Response: videos[] array with YouTube URLs
         ↓
If no videos → try next release (up to 3 retries)
         ↓
Pick random video URL from the release
         ↓
Emit as SEARCH_ITEM with YouTube URL
         ↓
C plugin resolves via existing YouTube resolve path → ffmpeg → audio
```

## IPC Commands

### CRATEDIG_INIT
No-op warmup. Responds `CRATEDIG_OK`.

### CRATEDIG_FILTER\t{json}
Sets filters. JSON format:
```json
{"genre": "Funk / Soul", "style": "P-Funk", "decade": "1970s", "country": "US"}
```
All fields optional. Empty string or omitted = "Any". Responds `CRATEDIG_OK`.

### CRATEDIG_SEARCH\t{count}
Fetches `count` random releases matching current filters, picks a random video from each. Emits standard `SEARCH_ITEM` protocol with YouTube URLs and metadata (genre, style, country, year in extended fields).

## Filters

### Genre (Discogs top-level, all included)
Blues, Brass & Military, Children's, Classical, Electronic, Folk World & Country, Funk / Soul, Hip Hop, Jazz, Latin, Non-Music, Pop, Reggae, Rock, Stage & Screen

### Style (per-genre, hardcoded from Discogs taxonomy)
Two-level menu: pick genre → pick style or "Any".

Example styles for Funk / Soul: Funk, Soul, Disco, P-Funk, Boogie, Northern Soul, Rhythm & Blues, Gospel, etc.

### Decade
Any, 1950s, 1960s, 1970s, 1980s, 1990s, 2000s, 2010s, 2020s

Maps to Discogs `year` parameter as range (e.g. 1970s → year=1970-1979).

### Country
Any, US, UK, Jamaica, Brazil, Japan, Nigeria, France, Germany, Italy, etc.

Hardcoded list of ~20 musically interesting countries.

## API Details

- **Auth**: Unauthenticated (25 req/min). No token needed.
- **Rate limit**: Each shuffle costs 2-3 requests (search + release detail + possible retry). ~10 shuffles/min ceiling.
- **Video coverage**: ~80% of releases in popular genres have YouTube video links. Releases without videos are skipped.
- **User-Agent**: Required by Discogs. Use `MoveAnythingWebstream/1.0`.

## C Plugin Changes

- Rename `samplette_*` fields to `cratedig_*` (`cratedig_auto_advance`, `cratedig_result_index`, `cratedig_pending_filter`)
- Add `cratedig` to `normalize_provider_value()`
- All other shuffle infrastructure (auto-advance on EOF, next track, result index tracking) reused as-is

## UI Changes

- Add `{ id: 'cratedig', label: 'Crate Dig' }` to PROVIDERS list
- Add `[CD]` to PROVIDER_TAGS
- Hardcoded genre/style/decade/country filter menus (replacing samplette's genre/key/tempo menus)
- Reuse samplette's shuffle UX: Shuffle button, Next Track, Now Playing, History, Filters submenu
- Keep samplette code commented out

## Files Modified

1. `src/bin/yt_dlp_daemon.py` — CrateDigSession class, 3 IPC commands (~80 lines)
2. `src/dsp/yt_stream_plugin.c` — rename samplette fields, add provider (~20 lines)
3. `src/ui.js` — Crate Dig provider, filter menus (~150 lines)
