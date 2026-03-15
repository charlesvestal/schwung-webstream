# Crate Dig Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Crate Dig" provider that discovers random music via the Discogs API and plays it through the existing YouTube resolve pipeline.

**Architecture:** Daemon gets a CrateDigSession class that searches Discogs with genre/style/decade/country filters, fetches release details for YouTube video URLs, and emits standard SEARCH_ITEM results. C plugin renames samplette_* fields to cratedig_* and adds the provider. UI adds Crate Dig to the provider list with hardcoded filter menus.

**Tech Stack:** Python (urllib, json), C, QuickJS JavaScript

---

### Task 1: Daemon — CrateDigSession class and IPC commands

**Files:**
- Modify: `src/bin/yt_dlp_daemon.py`

**Step 1: Add cratedig provider normalization (already done for jamendo, update)**

In `normalize_provider()`, the `jamendo` alias was added earlier. Replace it with `cratedig`:

```python
    if p in ("cd", "cratedig"):
        return "cratedig"
```

Remove the jamendo alias that was added earlier.

**Step 2: Add CrateDigSession class**

Add after the `SampletteSession` class (after line ~703). This class:
- Stores current filter state (genre, style, decade, country)
- Searches Discogs with random page offset
- Fetches release details and extracts YouTube video URLs
- Maintains an exclude list of seen release IDs

```python
class CrateDigSession:
    DISCOGS_BASE = "https://api.discogs.com"
    MAX_EXCLUDE_IDS = 200
    USER_AGENT = "MoveAnythingWebstream/1.0 +https://github.com/charlesvestal/move-anything-webstream"

    def __init__(self):
        self.filter_genre = ""
        self.filter_style = ""
        self.filter_decade = ""
        self.filter_country = ""
        self.exclude_ids: list = []
        self.pool_size_cache: dict = {}

    def _request(self, path: str, params: dict = None) -> dict:
        url = f"{self.DISCOGS_BASE}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params, doseq=True)
        req = urllib.request.Request(url, headers={"User-Agent": self.USER_AGENT})
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))

    def set_filter(self, filter_json: str):
        data = json.loads(filter_json)
        self.filter_genre = data.get("genre", "")
        self.filter_style = data.get("style", "")
        self.filter_decade = data.get("decade", "")
        self.filter_country = data.get("country", "")
        self.exclude_ids = []
        self.pool_size_cache = {}

    def _build_search_params(self) -> dict:
        params = {"type": "release", "per_page": "5"}
        if self.filter_genre:
            params["genre"] = self.filter_genre
        if self.filter_style:
            params["style"] = self.filter_style
        if self.filter_country:
            params["country"] = self.filter_country
        if self.filter_decade:
            decade = self.filter_decade.replace("s", "")
            try:
                start = int(decade)
                params["year"] = f"{start}-{start + 9}"
            except Exception:
                pass
        return params

    def _cache_key(self) -> str:
        return f"{self.filter_genre}|{self.filter_style}|{self.filter_decade}|{self.filter_country}"

    def _get_pool_size(self, params: dict) -> int:
        key = self._cache_key()
        if key in self.pool_size_cache:
            return self.pool_size_cache[key]
        probe = dict(params)
        probe["per_page"] = "1"
        probe["page"] = "1"
        data = self._request("/database/search", probe)
        pagination = data.get("pagination", {})
        pages = pagination.get("pages", 0)
        pages = min(pages, 10000)
        self.pool_size_cache[key] = pages
        return pages

    def get_random_releases(self, count: int = 10) -> list:
        import random
        params = self._build_search_params()
        pool_size = self._get_pool_size(params)
        if pool_size == 0:
            return []

        found = []
        attempts = 0
        max_attempts = count * 4

        while len(found) < count and attempts < max_attempts:
            attempts += 1
            page = random.randint(1, pool_size)
            params["page"] = str(page)
            params["per_page"] = "5"

            try:
                data = self._request("/database/search", params)
            except Exception:
                continue

            results = data.get("results", [])
            if not results:
                continue

            entry = results[random.randint(0, len(results) - 1)]
            release_id = entry.get("id")
            if not release_id or release_id in self.exclude_ids:
                continue

            try:
                release = self._request(f"/releases/{release_id}")
            except Exception:
                continue

            videos = release.get("videos", [])
            if not videos:
                continue

            video = videos[random.randint(0, len(videos) - 1)]
            video_url = video.get("uri", "")
            if not video_url or "youtube.com" not in video_url:
                youtube_videos = [v for v in videos if "youtube.com" in (v.get("uri") or "")]
                if not youtube_videos:
                    continue
                video = youtube_videos[random.randint(0, len(youtube_videos) - 1)]
                video_url = video.get("uri", "")

            artists = release.get("artists", [])
            artist_name = artists[0].get("name", "") if artists else ""
            title = release.get("title", "")
            year = str(release.get("year") or "")
            country = release.get("country") or ""
            genres = release.get("genres") or []
            styles = release.get("styles") or []
            genre_str = ", ".join(genres) if isinstance(genres, list) else ""
            style_str = ", ".join(styles) if isinstance(styles, list) else ""
            video_title = video.get("title", f"{artist_name} - {title}")
            video_duration = video.get("duration")

            self.exclude_ids.append(release_id)
            if len(self.exclude_ids) > self.MAX_EXCLUDE_IDS:
                self.exclude_ids = self.exclude_ids[-self.MAX_EXCLUDE_IDS:]

            found.append({
                "id": str(release_id),
                "title": video_title,
                "channel": artist_name,
                "duration": video_duration,
                "url": video_url,
                "genre": genre_str,
                "style": style_str,
                "country": country,
                "year": year,
            })

        return found
```

**Step 3: Add IPC command handlers**

Add after `samplette_search()` (around line ~771):

```python
def cratedig_init(session: CrateDigSession) -> None:
    write_fields("CRATEDIG_OK")


def cratedig_filter(session: CrateDigSession, filter_json: str) -> None:
    session.set_filter(filter_json)
    write_fields("CRATEDIG_OK")


def cratedig_search(session: CrateDigSession, count_text: str) -> None:
    try:
        count = int(count_text)
    except Exception:
        count = 10
    if count < 1:
        count = 1
    if count > 20:
        count = 20

    releases = session.get_random_releases(count)

    n = 0
    write_fields("SEARCH_BEGIN")
    for item in releases:
        sid = clean_field(item.get("id") or "")
        title = clean_field(item.get("title") or "")
        channel = clean_field(item.get("channel") or "")
        duration = format_duration(item.get("duration"))
        url = clean_field(item.get("url") or "")
        genre = clean_field(item.get("genre") or "")
        style = clean_field(item.get("style") or "")
        country = clean_field(item.get("country") or "")
        year = clean_field(item.get("year") or "")

        if not title or not url:
            continue

        write_fields("SEARCH_ITEM", sid, title, channel, duration, url,
                     "", "", "", genre, style, country, year)
        n += 1

    write_fields("SEARCH_END", str(n))
```

**Step 4: Wire commands into main loop**

In `main()`, after the `SampletteSession()` instantiation (~line 809), add:

```python
    cratedig = CrateDigSession()
```

In the command dispatch loop, after the `SAMPLETTE_SEARCH` handler (~line 836), add:

```python
            elif cmd == "CRATEDIG_INIT":
                cratedig_init(cratedig)
            elif cmd == "CRATEDIG_FILTER":
                filter_json = "\t".join(parts[1:]) if len(parts) > 1 else "{}"
                cratedig_filter(cratedig, filter_json)
            elif cmd == "CRATEDIG_SEARCH":
                count_text = parts[1] if len(parts) > 1 else "10"
                cratedig_search(cratedig, count_text)
```

**Step 5: Commit**

```bash
git add src/bin/yt_dlp_daemon.py
git commit -m "feat: add CrateDigSession — Discogs random discovery provider"
```

---

### Task 2: C plugin — rename samplette fields to cratedig, add provider

**Files:**
- Modify: `src/dsp/yt_stream_plugin.c`

**Step 1: Rename struct fields**

In the instance struct (~lines 129-133), rename:
- `samplette_result_index` → `cratedig_result_index`
- `samplette_auto_advance` → `cratedig_auto_advance`
- `samplette_pending_filter` → `cratedig_pending_filter`

**Step 2: Add cratedig to normalize_provider_value**

After the samplette block (~line 448-451), add:

```c
    if (strcmp(tmp, "cd") == 0 || strcmp(tmp, "cratedig") == 0) {
        snprintf(out, out_len, "cratedig");
        return;
    }
```

**Step 3: Update all references to renamed fields**

Global find-and-replace in the file:
- `inst->samplette_result_index` → `inst->cratedig_result_index`
- `inst->samplette_auto_advance` → `inst->cratedig_auto_advance`
- `inst->samplette_pending_filter` → `inst->cratedig_pending_filter`

**Step 4: Update IPC command strings and param names**

Replace these string literals:
- `"samplette_result_index"` → `"cratedig_result_index"` (in set_param and get_param)
- `"samplette_auto_advance"` → `"cratedig_auto_advance"` (in set_param and get_param)
- `"samplette_filter"` → `"cratedig_filter"` (in set_param)
- `"SAMPLETTE_FILTER\t%s\n"` → `"CRATEDIG_FILTER\t%s\n"` (in search command builder)
- `"SAMPLETTE_SEARCH\t%d\n"` → `"CRATEDIG_SEARCH\t%d\n"` (in search command builder)

**Step 5: Update is_samplette to is_cratedig**

In `run_search_command_daemon()` (~line 1102-1114):
- Rename `is_samplette` → `is_cratedig`
- Change the check from `strcmp(clean_provider, "samplette") == 0` to `(strcmp(clean_provider, "samplette") == 0 || strcmp(clean_provider, "cratedig") == 0)`
- Update all references to `is_samplette` in this function to `is_cratedig`

**Step 6: Update provider set in search result handling**

In the SEARCH_ITEM handler (~line 1178-1179), where it sets the result provider to "youtube" for samplette, extend for cratedig:

```c
    snprintf(results[count].provider, sizeof(results[count].provider), "%s",
             is_cratedig ? "youtube" : clean_provider);
```

**Step 7: Update provider in set_param for cratedig_filter**

In the `cratedig_filter` set_param handler (~line 2214), change:
- `"samplette"` → check the current search_provider or use the provider that triggered it

Actually, this needs to support both: if the filter came from samplette UI, use "samplette"; if from cratedig UI, use "cratedig". Since we renamed the param to `cratedig_filter`, it will only be set by the cratedig UI. Change line 2214 to:

```c
        snprintf(inst->search_provider, sizeof(inst->search_provider), "cratedig");
```

**Step 8: Update warmup thread**

In `warmup_thread_main()` (~lines 356-365), change `SAMPLETTE_INIT` to `CRATEDIG_INIT` and update log messages:

```c
        if (fputs("CRATEDIG_INIT\n", inst->daemon_in) != EOF) {
            fflush(inst->daemon_in);
            if (read_daemon_line_locked(inst, line, sizeof(line), 20000) == 0) {
                yt_log("cratedig session pre-warmed");
            } else {
                yt_log("cratedig session pre-warm timeout");
            }
        }
```

**Step 9: Update EOF auto-advance provider**

In `render_block` (~line 2530), change the provider set during auto-advance from `"youtube"` — this is already correct since cratedig results have `provider=youtube` set in step 6.

**Step 10: Commit**

```bash
git add src/dsp/yt_stream_plugin.c
git commit -m "feat: rename samplette fields to cratedig, add cratedig provider"
```

---

### Task 3: UI — add Crate Dig provider with filter menus

**Files:**
- Modify: `src/ui.js`

**Step 1: Add provider to PROVIDERS and PROVIDER_TAGS**

In PROVIDERS array (~line 32-38), add before the commented samplette line:

```javascript
  { id: 'cratedig', label: 'Crate Dig' },
```

In PROVIDER_TAGS (~line 39-45), add:

```javascript
  cratedig: '[CD]',
```

**Step 2: Replace samplette filter constants with cratedig constants**

Replace `SAMPLETTE_GENRES`, `SAMPLETTE_KEYS`, `SAMPLETTE_TEMPOS` (~lines 47-61) with:

```javascript
const CRATEDIG_GENRES = [
  'Any', 'Blues', 'Brass & Military', "Children's", 'Classical',
  'Electronic', 'Folk, World, & Country', 'Funk / Soul', 'Hip Hop',
  'Jazz', 'Latin', 'Non-Music', 'Pop', 'Reggae', 'Rock', 'Stage & Screen'
];

const CRATEDIG_STYLES = {
  'Blues': ['Any', 'Chicago Blues', 'Country Blues', 'Delta Blues', 'Electric Blues', 'Harmonica Blues', 'Jump Blues', 'Louisiana Blues', 'Modern Electric Blues', 'Piano Blues', 'Rhythm & Blues', 'Texas Blues'],
  'Brass & Military': ['Any', 'Brass Band', 'Marches', 'Military'],
  "Children's": ['Any', 'Educational', 'Nursery Rhymes', 'Story'],
  'Classical': ['Any', 'Baroque', 'Classical', 'Contemporary', 'Impressionist', 'Medieval', 'Modern', 'Neo-Classical', 'Neo-Romantic', 'Opera', 'Post-Modern', 'Renaissance', 'Romantic'],
  'Electronic': ['Any', 'Abstract', 'Acid', 'Acid House', 'Acid Jazz', 'Ambient', 'Breakbeat', 'Breakcore', 'Breaks', 'Dark Ambient', 'Deep House', 'Disco', 'Downtempo', 'Drone', 'Dub Techno', 'Electro', 'Experimental', 'Garage House', 'House', 'IDM', 'Industrial', 'Jungle', 'Leftfield', 'Minimal', 'Musique Concrète', 'Noise', 'Nu-Disco', 'Synth-pop', 'Techno', 'Trance', 'Trip Hop'],
  'Folk, World, & Country': ['Any', 'African', 'Afrobeat', 'Bluegrass', 'Cajun', 'Celtic', 'Country', 'Fado', 'Flamenco', 'Folk', 'Gospel', 'Highlife', 'Hindustani', 'Honky Tonk', 'Indian Classical', 'Klezmer', 'Nordic', 'Pacific', 'Polka', 'Raï', 'Rockabilly', 'Soca', 'Soukous', 'Zydeco'],
  'Funk / Soul': ['Any', 'Afrobeat', 'Boogie', 'Contemporary R&B', 'Disco', 'Free Funk', 'Funk', 'Gospel', 'Neo Soul', 'New Jack Swing', 'Northern Soul', 'P.Funk', 'Psychedelic', 'Rhythm & Blues', 'Soul', 'Swingbeat'],
  'Hip Hop': ['Any', 'Bass Music', 'Boom Bap', 'Conscious', 'Crunk', 'Cut-up/DJ', 'Electro', 'G-Funk', 'Gangsta', 'Grime', 'Hardcore Hip-Hop', 'Instrumental', 'Jazz-Funk', 'Pop Rap', 'RnB/Swing', 'Thug Rap', 'Trip Hop', 'Turntablism'],
  'Jazz': ['Any', 'Afro-Cuban Jazz', 'Avant-garde Jazz', 'Bebop', 'Big Band', 'Bop', 'Bossa Nova', 'Cool Jazz', 'Dixieland', 'Free Improvisation', 'Free Jazz', 'Fusion', 'Gypsy Jazz', 'Hard Bop', 'Jazz-Funk', 'Jazz-Rock', 'Latin Jazz', 'Modal', 'Post Bop', 'Ragtime', 'Smooth Jazz', 'Soul-Jazz', 'Space-Age', 'Swing'],
  'Latin': ['Any', 'Baião', 'Batucada', 'Bolero', 'Boogaloo', 'Bossa Nova', 'Cha-Cha', 'Charanga', 'Compas', 'Cumbia', 'Descarga', 'Forró', 'Guaracha', 'MPB', 'Mambo', 'Merengue', 'Norteño', 'Plena', 'Rumba', 'Salsa', 'Samba', 'Son', 'Tango', 'Tejano', 'Tropicália', 'Vallenato'],
  'Non-Music': ['Any', 'Audiobook', 'Comedy', 'Dialogue', 'Education', 'Field Recording', 'Interview', 'Monolog', 'Poetry', 'Political', 'Propaganda', 'Radioplay', 'Religious', 'Spoken Word'],
  'Pop': ['Any', 'Ballad', 'Baroque Pop', 'Britpop', 'Bubblegum', 'Chanson', 'City Pop', 'Dance-pop', 'Dream Pop', 'Europop', 'Indie Pop', 'J-pop', 'K-pop', 'New Wave', 'Power Pop', 'Schlager', 'Shoegaze', 'Sunshine Pop', 'Synth-pop', 'Teen Pop', 'Vocal'],
  'Reggae': ['Any', 'Calypso', 'Dancehall', 'Dub', 'Lovers Rock', 'Ragga', 'Reggae', 'Reggae-Pop', 'Rocksteady', 'Roots Reggae', 'Ska', 'Soca'],
  'Rock': ['Any', 'Acid Rock', 'Alternative Rock', 'Arena Rock', 'Art Rock', 'Blues Rock', 'Classic Rock', 'Doom Metal', 'Garage Rock', 'Glam', 'Grunge', 'Hard Rock', 'Indie Rock', 'Krautrock', 'Lo-Fi', 'Math Rock', 'Mod', 'Noise', 'Post-Punk', 'Post Rock', 'Prog Rock', 'Psychedelic Rock', 'Pub Rock', 'Punk', 'Shoegaze', 'Space Rock', 'Stoner Rock', 'Surf'],
  'Stage & Screen': ['Any', 'Musical', 'Score', 'Soundtrack', 'Theme']
};

const CRATEDIG_DECADES = [
  'Any', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'
];

const CRATEDIG_COUNTRIES = [
  'Any', 'US', 'UK', 'Jamaica', 'Brazil', 'Japan', 'Nigeria', 'France',
  'Germany', 'Italy', 'Cuba', 'Colombia', 'India', 'South Africa',
  'Ethiopia', 'Ghana', 'Senegal', 'Mexico', 'Argentina', 'Australia'
];
```

**Step 3: Replace samplette filter state with cratedig filter state**

Replace `sampletteFilter` (~lines 63-68) with:

```javascript
let cratedigFilter = {
  genre: '',
  style: '',
  decade: '',
  country: ''
};
```

**Step 4: Add cratedig to normalizeProvider**

In `normalizeProvider()` (~line 96-105), add:

```javascript
  if (raw === 'cd') return 'cratedig';
```

**Step 5: Replace samplette filter/shuffle functions**

Replace `sampletteApplyFilter()`, `sampletteShuffle()`, `sampletteNextTrack()` (~lines 375-393) with:

```javascript
function cratedigApplyFilter() {
  host_module_set_param('cratedig_filter', JSON.stringify(cratedigFilter));
  statusMessage = 'Digging...';
  needsRedraw = true;
}

function cratedigShuffle() {
  host_module_set_param('cratedig_auto_advance', '1');
  cratedigApplyFilter();
  statusMessage = 'Digging...';
  needsRedraw = true;
}

function cratedigNextTrack() {
  host_module_set_param('next_track_step', 'trigger');
  scrollOffset = 0;
  statusMessage = 'Next track...';
  needsRedraw = true;
}
```

**Step 6: Replace samplette filter menus with cratedig filter menus**

Replace `refreshFiltersMenu()`, `openSampletteGenreMenu()`, `openSampletteKeyMenu()`, `openSampletteTempoMenu()`, `openSampletteFiltersMenu()` (~lines 395-489) with:

```javascript
function refreshFiltersMenu() {
  const current = menuStack.current();
  if (!current || current.title !== 'Filters') return;
  const genreLabel = cratedigFilter.genre || 'Any';
  const styleLabel = cratedigFilter.style || 'Any';
  const decadeLabel = cratedigFilter.decade || 'Any';
  const countryLabel = cratedigFilter.country || 'Any';

  current.items = [
    createAction('Genre: ' + genreLabel, function() { openCratedigGenreMenu(); }),
    createAction('Style: ' + styleLabel, function() { openCratedigStyleMenu(); }),
    createAction('Decade: ' + decadeLabel, function() { openCratedigDecadeMenu(); }),
    createAction('Country: ' + countryLabel, function() { openCratedigCountryMenu(); }),
    createAction('[Apply & Dig]', function() {
      while (menuStack.depth() > 1) menuStack.pop();
      menuState.selectedIndex = 0;
      cratedigShuffle();
    })
  ];
  clampSelectedIndex();
  needsRedraw = true;
}

function openCratedigGenreMenu() {
  const items = CRATEDIG_GENRES.map(function(g) {
    var current = cratedigFilter.genre || 'Any';
    var prefix = (g === current) ? '> ' : '  ';
    return createAction(prefix + g, function() {
      cratedigFilter.genre = (g === 'Any') ? '' : g;
      cratedigFilter.style = '';
      menuStack.pop();
      menuState.selectedIndex = 0;
      refreshFiltersMenu();
    });
  });
  menuStack.push({ title: 'Genre', items: items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openCratedigStyleMenu() {
  var genre = cratedigFilter.genre;
  var styleList = (genre && CRATEDIG_STYLES[genre]) ? CRATEDIG_STYLES[genre] : ['Any'];
  var items = styleList.map(function(s) {
    var current = cratedigFilter.style || 'Any';
    var prefix = (s === current) ? '> ' : '  ';
    return createAction(prefix + s, function() {
      cratedigFilter.style = (s === 'Any') ? '' : s;
      menuStack.pop();
      menuState.selectedIndex = 0;
      refreshFiltersMenu();
    });
  });
  menuStack.push({ title: 'Style', items: items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openCratedigDecadeMenu() {
  var items = CRATEDIG_DECADES.map(function(d) {
    var current = cratedigFilter.decade || 'Any';
    var prefix = (d === current) ? '> ' : '  ';
    return createAction(prefix + d, function() {
      cratedigFilter.decade = (d === 'Any') ? '' : d;
      menuStack.pop();
      menuState.selectedIndex = 0;
      refreshFiltersMenu();
    });
  });
  menuStack.push({ title: 'Decade', items: items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openCratedigCountryMenu() {
  var items = CRATEDIG_COUNTRIES.map(function(c) {
    var current = cratedigFilter.country || 'Any';
    var prefix = (c === current) ? '> ' : '  ';
    return createAction(prefix + c, function() {
      cratedigFilter.country = (c === 'Any') ? '' : c;
      menuStack.pop();
      menuState.selectedIndex = 0;
      refreshFiltersMenu();
    });
  });
  menuStack.push({ title: 'Country', items: items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openCratedigFiltersMenu() {
  var genreLabel = cratedigFilter.genre || 'Any';
  var styleLabel = cratedigFilter.style || 'Any';
  var decadeLabel = cratedigFilter.decade || 'Any';
  var countryLabel = cratedigFilter.country || 'Any';

  var items = [
    createAction('Genre: ' + genreLabel, function() { openCratedigGenreMenu(); }),
    createAction('Style: ' + styleLabel, function() { openCratedigStyleMenu(); }),
    createAction('Decade: ' + decadeLabel, function() { openCratedigDecadeMenu(); }),
    createAction('Country: ' + countryLabel, function() { openCratedigCountryMenu(); }),
    createAction('[Apply & Dig]', function() {
      while (menuStack.depth() > 1) menuStack.pop();
      menuState.selectedIndex = 0;
      cratedigShuffle();
    })
  ];
  menuStack.push({ title: 'Filters', items: items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}
```

**Step 7: Update getCurrentlyPlayingResult**

Replace the samplette check (~line 492) to check for cratedig:

```javascript
function getCurrentlyPlayingResult() {
  if (searchProvider === 'samplette' || searchProvider === 'cratedig') {
    const idx = parseInt(host_module_get_param('cratedig_result_index') || '0', 10);
    if (idx >= 0 && idx < results.length) return results[idx];
    return null;
  }
  const currentUrl = host_module_get_param('stream_url') || '';
  if (!currentUrl) return null;
  return results.find((r) => r.url === currentUrl) || null;
}
```

**Step 8: Update now-playing label**

Rename `sampletteNowPlayingLabel` to handle cratedig too (~line 502):

```javascript
function cratedigNowPlayingLabel() {
  const r = getCurrentlyPlayingResult();
  if (!r) return null;
  const parts = [cleanLabel(r.title, 20)];
  if (r.meta_genre) parts.push(cleanLabel(r.meta_genre, 14));
  if (r.meta_year) parts.push(r.meta_year);
  if (r.meta_country) parts.push(cleanLabel(r.meta_country, 10));
  return parts.join(' | ');
}
```

**Step 9: Update provider menu to handle cratedig selection**

In `openProviderMenu()` (~lines 350-373), update the samplette check to also handle cratedig:

```javascript
    if (provider.id === 'cratedig') {
      searchProvider = 'cratedig';
      host_module_set_param('search_provider', 'cratedig');
      rebuildMenu();
      cratedigShuffle();
      return;
    }
```

Keep the existing samplette block (it's behind the commented-out provider entry).

**Step 10: Update buildSampletteRootItems → buildCratedigRootItems**

Rename and update `buildSampletteRootItems()` (~lines 628-653):

```javascript
function buildCratedigRootItems() {
  const isLoading = streamStatus === 'loading' || streamStatus === 'buffering';
  const isStopped = streamStatus === 'stopped' || streamStatus === 'eof';
  const items = [];
  if (!(isStopped && results.length === 0)) {
    items.push(createAction(playPauseLabel(), function() { togglePlayPause(); }));
  }
  if (!isLoading) {
    items.push(createAction('[Dig!]', function() { cratedigShuffle(); }));
  }
  if (isPlaying()) {
    items.push(createAction('[Next Track]', function() { cratedigNextTrack(); }));
    items.push(createAction('[<< 15s]', function() { host_module_set_param('rewind_15_step', 'trigger'); statusMessage = 'Rewind 15s'; needsRedraw = true; }));
    items.push(createAction('[15s >>]', function() { host_module_set_param('forward_15_step', 'trigger'); statusMessage = 'Forward 15s'; needsRedraw = true; }));
    items.push(createAction('[Now Playing...]', function() { openNowPlayingMenu(); }));
  }
  items.push(createAction('[Filters...]', function() { openCratedigFiltersMenu(); }));
  items.push(createAction('[History...]', function() { openCratedigHistoryMenu(); }));
  items.push(createAction('[Change Provider...]', function() {
    clearSearchState(true);
    openProviderMenu();
  }));
  return items;
}
```

**Step 11: Update buildRootItems to use cratedig**

In `buildRootItems()` (~line 655-657), change the samplette check:

```javascript
function buildRootItems() {
  if (searchProvider === 'cratedig') {
    return buildCratedigRootItems();
  }
  if (searchProvider === 'samplette') {
    return buildSampletteRootItems();
  }
```

**Step 12: Rename openSampletteHistoryMenu → openCratedigHistoryMenu**

Update the history menu (~lines 546-585) to use cratedig params:

```javascript
function openCratedigHistoryMenu() {
  if (results.length === 0) {
    menuStack.push({
      title: 'History',
      items: [createAction('(No tracks yet)', function() {})],
      selectedIndex: 0
    });
    menuState.selectedIndex = 0;
    needsRedraw = true;
    return;
  }

  const items = [];
  const count = Math.min(results.length, MAX_MENU_RESULTS);
  for (let i = 0; i < count; i++) {
    const row = results[i];
    const title = cleanLabel(row && row.title ? row.title : 'Result ' + (i + 1));
    const meta = [];
    if (row && row.meta_genre) meta.push(cleanLabel(row.meta_genre, 10));
    if (row && row.meta_year) meta.push(row.meta_year);
    const suffix = meta.length > 0 ? ' [' + meta.join(' ') + ']' : '';
    items.push(
      createAction(title + suffix, (function(r, idx) { return function() {
        if (!r || !r.url) return;
        host_module_set_param('cratedig_auto_advance', '1');
        host_module_set_param('cratedig_result_index', String(idx));
        host_module_set_param('stream_provider', 'youtube');
        host_module_set_param('stream_url', r.url);
        while (menuStack.depth() > 1) menuStack.pop();
        menuState.selectedIndex = 0;
        statusMessage = 'Loading...';
        needsRedraw = true;
      }; })(row, i))
    );
  }

  menuStack.push({ title: 'History', items: items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}
```

**Step 13: Update loadResults to handle cratedig metadata**

In `loadResults()` (~lines 716-738), update the samplette check:

```javascript
    const isCratedig = searchProvider === 'cratedig' || searchProvider === 'samplette';
```

Replace `if (isSamplette)` with `if (isCratedig)`.

**Step 14: Update refreshState cratedig references**

In `refreshState()` (~lines 740-797), replace samplette checks with cratedig:
- `searchProvider === 'samplette'` → `searchProvider === 'samplette' || searchProvider === 'cratedig'`
- Update status messages: `'Finding tracks...'` → use for both

**Step 15: Update togglePlayPause cratedig references**

In `togglePlayPause()` (~lines 595-622), replace `searchProvider === 'samplette'` with `searchProvider === 'samplette' || searchProvider === 'cratedig'`, and update param names from `samplette_*` to `cratedig_*`.

**Step 16: Update nowPlayingFooter**

In `nowPlayingFooter()` (~lines 830-841), replace samplette check:

```javascript
  if (searchProvider === 'cratedig') {
    return cratedigNowPlayingLabel();
  }
  if (searchProvider === 'samplette') {
    return sampletteNowPlayingLabel();
  }
```

**Step 17: Commit**

```bash
git add src/ui.js
git commit -m "feat: add Crate Dig provider UI with genre/style/decade/country filters"
```

---

### Task 4: Test wiring

**Files:**
- Create: `tests/test_cratedig_wiring.sh`

**Step 1: Write the test**

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSP_C="$ROOT_DIR/src/dsp/yt_stream_plugin.c"
UI_JS="$ROOT_DIR/src/ui.js"
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

# UI exposes cratedig provider
if ! rg -q "'cratedig'" "$UI_JS"; then
  echo "FAIL: ui.js should expose cratedig provider"
  fail=1
fi

# UI has filter menus
for fn in openCratedigGenreMenu openCratedigStyleMenu openCratedigDecadeMenu openCratedigCountryMenu; do
  if ! rg -q "function ${fn}" "$UI_JS"; then
    echo "FAIL: ui.js should implement ${fn}()"
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "PASS: Crate Dig wiring is present across all layers"
```

**Step 2: Run the test**

```bash
bash tests/test_cratedig_wiring.sh
```

Expected: PASS

**Step 3: Run existing tests to check for regressions**

```bash
for t in tests/test_*.sh; do bash "$t"; done
```

Expected: All PASS

**Step 4: Commit**

```bash
git add tests/test_cratedig_wiring.sh
git commit -m "test: add Crate Dig wiring test"
```

---

### Task 5: Build and smoke test

**Step 1: Build the module**

```bash
./scripts/build.sh
```

Expected: Clean build, no errors.

**Step 2: Deploy to device**

```bash
./scripts/install.sh
```

**Step 3: Smoke test on device**

1. Enter webstream module
2. New Search → select Crate Dig
3. Should immediately shuffle with default "Any" filters
4. Verify audio plays
5. Open Filters → set Genre: Funk / Soul → Style: P.Funk → Decade: 1970s
6. Apply & Dig → verify new random track plays
7. Next Track → verify advances to next result
8. Check Now Playing → verify genre/year/country metadata shows
