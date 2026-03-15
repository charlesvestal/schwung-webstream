# Samplette Integration Design

Integrate samplette.io as a discovery provider in the webstream module, enabling genre/key/tempo-filtered music discovery from a curated YouTube catalog with Discogs + AcousticBrainz metadata.

## API (validated)

Samplette.io exposes a simple session-based REST API. No browser needed — plain Python `requests` works.

**Session init**: `GET /` → extract session cookie + CSRF token from `<meta name="csrf-token">` tag.

**Endpoints used**:
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/get_sample` | POST | Get random tracks (returns YouTube URLs + metadata) |
| `/filter_state` | POST | Set genre/style/country/key/tempo/year filters |
| `/genres_lov` | GET | List of genres (14 items) |
| `/styles_lov` | GET | List of styles (~600 items) |
| `/countries_lov` | GET | List of countries (~200 items) |

**get_sample request**:
```json
{"id":null,"include-previously-seen":false,"exclude":[<seen_ids>],
 "previous-ids":[],"kind":"random","count":10,"repeat-between-sessions":false}
```

**get_sample response** (array of objects):
```json
{
  "id": 42094308,
  "best_title": "Track Title",
  "channel": "YouTube Channel",
  "duration": 379,
  "url": "http://www.youtube.com/watch?v=xxx",
  "views": 13028,
  "published": "2009-12-13 03:31:33",
  "acousticbrainz": {"key":"E","scale":"minor","tempo":110,"tonality":"E minor"},
  "discogs": {
    "artist_array": ["Artist"],
    "genre_array": ["Electronic"],
    "style_array": ["Downtempo","Trip Hop"],
    "country": "UK",
    "year": 1994,
    "label_array": ["Label"],
    "title": "Release Title"
  }
}
```

**filter_state request**:
```json
{"genre":["Funk / Soul"],"style":[],"country":[],"key":["C"],
 "tempo_min":80,"tempo_max":120,
 "year_min":null,"year_max":null,
 "views_min":null,"views_max":null,"time_sig":[]}
```

**Required headers** for POST requests:
- `X-CSRFToken: <signed_token_from_meta_tag>`
- `X-Requested-With: XMLHttpRequest`
- `Content-Type: application/json; charset=UTF-8`
- `Origin: https://samplette.io`
- `Referer: https://samplette.io/`

## Daemon Layer

New commands in `yt_dlp_daemon.py`:

```
SAMPLETTE_INIT
  → GET / to establish session + CSRF
  → GET genres_lov, styles_lov, countries_lov
  → Returns: OK\t<genres_json>\t<styles_json>\t<countries_json>

SAMPLETTE_FILTER\t<filter_json>
  → POST /filter_state
  → Returns: OK or ERROR\t<message>

SAMPLETTE_SEARCH\t<count>
  → POST /get_sample with exclude list of seen IDs
  → Returns tab-delimited rows:
    ID\tTITLE\tCHANNEL\tDURATION\tURL\tKEY\tSCALE\tTEMPO\tGENRE\tSTYLE\tCOUNTRY\tYEAR
  → Accumulates seen IDs in exclude list (caps at 200, resets on filter change)
```

Session is lazy-initialized on first `SAMPLETTE_SEARCH` if not already active. On auth errors, auto re-init.

## C Plugin Changes

**New provider**: `PROVIDER_SAMPLETTE` (index 4).

**Extended search_result_t**: Add fields for `key`, `scale`, `tempo`, `genre`, `style`, `country`, `year` strings from samplette metadata.

**Search**: When provider is samplette, search thread sends `SAMPLETTE_SEARCH\t10` instead of `SEARCH\t...`. Parses extended fields.

**Resolve**: Samplette returns YouTube URLs → uses existing `RESOLVE\tyoutube\t<url>` path. No new resolve logic.

**Auto-advance**: On `stream_eof` when provider is samplette, auto-pick next result from `search_results[]` and begin streaming. When results exhausted, auto-fetch 10 more via `SAMPLETTE_SEARCH`.

**Next track**: New param `next_track_step` (enum trigger) to skip to next result immediately.

## UI Design

```
Webstream [Samplette]
├── [Shuffle]              → Play random track from current filter
├── [Next Track]           → Skip to next in batch
├── [Filters...]
│   ├── Genre: [All] Jazz / Funk/Soul / Electronic / ...
│   ├── Style: [All] Ambient / Boom Bap / City Pop / ...
│   ├── Key: [All] C / C# / D / ... / B  [+ Match Project]
│   ├── Tempo: [All] / Slow 60-90 / Med 90-120 / Fast 120-150 / Match Project
│   └── Country: [All] / US / UK / Japan / ...
├── [Now Playing]          → Title, artist, genre, style, key, tempo, year
└── [History...]           → Recent samplette tracks
```

**Knob mappings**: Existing play/pause/rewind/forward/stop/restart all work. Knob3 (Forward) long-press or double-tap = Next Track shortcut.

**"Match Project"**: Read project key/tempo from host API if available. Auto-populate filter.

**LOV caching**: Genre/style/country lists fetched once at init, cached for session lifetime.

## Data Flow

```
Provider select → SAMPLETTE_INIT → session + LOV lists cached
Filter change   → SAMPLETTE_FILTER → SAMPLETTE_SEARCH → 10 results
Track select    → RESOLVE\tyoutube\t<url> → ffmpeg → ring buffer → audio
Track ends      → auto-advance to next result
Results empty   → SAMPLETTE_SEARCH → 10 more results
Session error   → auto re-init session
```

## Error Handling

- Samplette down: show "Samplette unavailable", other providers still work
- Session expired: auto re-init on error response
- Exclude list: caps at 200 IDs, resets on filter change
- Network timeout: 12s (matching existing daemon timeouts)

## Implementation Order

1. Daemon: samplette session + SAMPLETTE_INIT/FILTER/SEARCH commands
2. C plugin: PROVIDER_SAMPLETTE + search parsing + auto-advance
3. UI: provider picker entry + filter menus + now playing display
4. UI: next track knob shortcut + match project feature
