import * as std from 'std';
import * as os from 'os';

import {
  openTextEntry,
  isTextEntryActive,
  handleTextEntryMidi,
  drawTextEntry,
  tickTextEntry
} from '/data/UserData/move-anything/shared/text_entry.mjs';

import {
  MidiNoteOn,
  MoveShift,
  MoveKnob1, MoveKnob2, MoveKnob3, MoveKnob7, MoveKnob8,
  MoveKnob1Touch, MoveKnob2Touch, MoveKnob3Touch, MoveKnob7Touch, MoveKnob8Touch
} from '/data/UserData/move-anything/shared/constants.mjs';

import { isCapacitiveTouchMessage, decodeDelta } from '/data/UserData/move-anything/shared/input_filter.mjs';

import { createAction } from '/data/UserData/move-anything/shared/menu_items.mjs';
import { createMenuState, handleMenuInput } from '/data/UserData/move-anything/shared/menu_nav.mjs';
import { createMenuStack } from '/data/UserData/move-anything/shared/menu_stack.mjs';
import { drawStackMenu } from '/data/UserData/move-anything/shared/menu_render.mjs';

const MAX_MENU_RESULTS = 20;
const MAX_SEARCH_HISTORY = 20;
const SEARCH_HISTORY_PATH = '/data/UserData/move-anything/config/webstream_search_history.json';
const LEGACY_SEARCH_HISTORY_PATH = '/data/UserData/move-anything/webstream_search_history.json';
const LEGACY_SEARCH_HISTORY_PATH_2 = '/data/UserData/move-anything/yt_search_history.json';
const SPINNER = ['-', '/', '|', '\\'];
const PROVIDERS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'freesound', label: 'FreeSound' },
  { id: 'archive', label: 'Archive.org' },
  { id: 'soundcloud', label: 'SoundCloud' },
  // { id: 'samplette', label: 'Samplette' }
];
const PROVIDER_TAGS = {
  youtube: '[YT]',
  freesound: '[FS]',
  archive: '[AR]',
  soundcloud: '[SC]',
  samplette: '[SA]'
};

const SAMPLETTE_GENRES = [
  'All', 'Blues', 'Brass & Military', 'Classical', 'Electronic',
  'Folk, World, & Country', 'Funk / Soul', 'Hip Hop', 'Jazz',
  'Latin', 'Pop', 'Reggae', 'Rock', 'Stage & Screen'
];
const SAMPLETTE_KEYS = [
  'All', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'
];
const SAMPLETTE_TEMPOS = [
  { label: 'All', min: null, max: null },
  { label: 'Slow (60-90)', min: 60, max: 90 },
  { label: 'Medium (90-120)', min: 90, max: 120 },
  { label: 'Fast (120-150)', min: 120, max: 150 },
  { label: 'Very Fast (150+)', min: 150, max: 300 }
];

let sampletteFilter = {
  genre: [], style: [], country: [], key: [],
  tempo_min: null, tempo_max: null,
  year_min: null, year_max: null,
  views_min: null, views_max: null, time_sig: []
};

let searchQuery = '';
let searchProvider = 'youtube';
let searchStatus = 'idle';
let searchCount = 0;
let streamStatus = 'stopped';
let selectedIndex = 0;
let statusMessage = 'Click: select';
let results = [];
let searchHistory = [];
let shiftHeld = false;

let menuState = createMenuState();
let menuStack = createMenuStack();
let rootMenu = null;

let tickCounter = 0;
let spinnerTick = 0;
let spinnerFrame = 0;
let needsRedraw = true;
let pendingKnobAction = null;
let scrollOffset = 0;
let scrollTick = 0;
const FOOTER_MAX_CHARS = 21;
const FOOTER_MAX_CHARS_WITH_TIME = 15;
const SCROLL_PAD = '   ';

function normalizeProvider(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'youtube';
  if (raw === 'yt') return 'youtube';
  if (raw === 'fs') return 'freesound';
  if (raw === 'ia' || raw === 'archiveorg' || raw === 'internetarchive') return 'archive';
  if (raw === 'sc') return 'soundcloud';
  if (raw === 'sa') return 'samplette';
  return raw;
}

function providerLabel(providerId) {
  const id = normalizeProvider(providerId);
  const found = PROVIDERS.find((p) => p.id === id);
  return found ? found.label : id;
}

function providerTag(providerId) {
  const id = normalizeProvider(providerId);
  return PROVIDER_TAGS[id] || '[??]';
}

function historyEntry(providerId, query) {
  return {
    provider: normalizeProvider(providerId),
    query: String(query || '').trim()
  };
}

function cleanLabel(text, maxLen = 24) {
  let s = String(text || '');
  s = s.replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) s = '(untitled)';
  if (s.length > maxLen) s = `${s.slice(0, Math.max(0, maxLen - 1))}…`;
  return s;
}

function currentActivityLabel() {
  if (searchStatus === 'searching') return 'Searching';
  if (searchStatus === 'queued') return 'Queued';
  if (streamStatus === 'loading') return 'Loading';
  if (streamStatus === 'buffering') return 'Buffering';
  if (streamStatus === 'seeking') return 'Seeking';
  return '';
}

function setPendingKnobAction(cc, action, prompt) {
  pendingKnobAction = { cc, action };
  statusMessage = prompt;
  needsRedraw = true;
}

function runKnobAction(action) {
  if (action === 'play_pause') {
    host_module_set_param('play_pause_step', 'trigger');
    statusMessage = 'Toggling pause...';
    return;
  }
  if (action === 'rewind_15') {
    host_module_set_param('rewind_15_step', 'trigger');
    statusMessage = 'Rewind 15s...';
    return;
  }
  if (action === 'forward_15') {
    host_module_set_param('forward_15_step', 'trigger');
    statusMessage = 'Forward 15s...';
    return;
  }
  if (action === 'stop') {
    host_module_set_param('stop_step', 'trigger');
    statusMessage = 'Stopping...';
    return;
  }
  if (action === 'restart') {
    host_module_set_param('restart_step', 'trigger');
    statusMessage = 'Restarting...';
  }
}

function clampSelectedIndex() {
  const current = menuStack.current();
  if (!current || !current.items || current.items.length === 0) {
    menuState.selectedIndex = 0;
    return;
  }
  if (menuState.selectedIndex < 0) menuState.selectedIndex = 0;
  if (menuState.selectedIndex >= current.items.length) {
    menuState.selectedIndex = current.items.length - 1;
  }
}

function addSearchToHistory(providerId, query) {
  const entry = historyEntry(providerId, query);
  if (!entry.query) return;
  searchHistory = searchHistory.filter((item) => !(item.provider === entry.provider && item.query === entry.query));
  searchHistory.unshift(entry);
  if (searchHistory.length > MAX_SEARCH_HISTORY) {
    searchHistory = searchHistory.slice(0, MAX_SEARCH_HISTORY);
  }
}

function writeTextFile(path, content) {
  let file;
  try {
    file = std.open(path, 'w');
    if (!file) return false;
    file.puts(content);
    file.close();
    return true;
  } catch (e) {
    if (file) {
      try { file.close(); } catch (_) {}
    }
    return false;
  }
}

function loadSearchHistoryFromDisk() {
  let raw = null;
  let fromLegacy = false;

  try {
    raw = std.loadFile(SEARCH_HISTORY_PATH);
    if (!raw) {
      raw = std.loadFile(LEGACY_SEARCH_HISTORY_PATH);
      if (!raw) {
        raw = std.loadFile(LEGACY_SEARCH_HISTORY_PATH_2);
      }
      fromLegacy = !!raw;
    }

    if (!raw) {
      searchHistory = [];
      return;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      searchHistory = [];
      return;
    }

    const next = [];
    for (const entry of parsed) {
      let item = null;
      if (typeof entry === 'string') {
        item = historyEntry('youtube', entry);
      } else if (entry && typeof entry === 'object') {
        item = historyEntry(entry.provider, entry.query);
      }
      if (!item || !item.query) continue;
      if (next.some((x) => x.provider === item.provider && x.query === item.query)) continue;
      next.push(item);
      if (next.length >= MAX_SEARCH_HISTORY) break;
    }
    searchHistory = next;

    if (fromLegacy) {
      saveSearchHistoryToDisk();
    }
  } catch (e) {
    searchHistory = [];
  }
}

function saveSearchHistoryToDisk() {
  const payload = `${JSON.stringify(searchHistory.slice(0, MAX_SEARCH_HISTORY))}\n`;
  const tmpPath = `${SEARCH_HISTORY_PATH}.tmp`;

  if (writeTextFile(tmpPath, payload)) {
    if (typeof os.rename === 'function') {
      const rc = os.rename(tmpPath, SEARCH_HISTORY_PATH);
      if (rc === 0) return;
    }

    writeTextFile(SEARCH_HISTORY_PATH, payload);
    if (typeof os.remove === 'function') {
      os.remove(tmpPath);
    }
    return;
  }

  writeTextFile(SEARCH_HISTORY_PATH, payload);
}

function submitSearch(providerId, query) {
  const provider = normalizeProvider(providerId);
  const q = String(query || '').trim();
  if (!q) return;

  searchProvider = provider;
  addSearchToHistory(provider, q);
  saveSearchHistoryToDisk();
  results = [];
  searchCount = 0;
  selectedIndex = 0;
  menuState.selectedIndex = 0;
  statusMessage = `Searching ${providerTag(provider)}...`;
  rebuildMenu();

  host_module_set_param('search_provider', provider);
  host_module_set_param('search_query', q);
}

function clearSearchState() {
  searchQuery = '';
  searchStatus = 'idle';
  searchCount = 0;
  results = [];
  selectedIndex = 0;
  menuState.selectedIndex = 0;
  host_module_set_param('search_query', '');
  statusMessage = 'New search';
  rebuildMenu();
}

function openSearchHistoryMenu() {
  loadSearchHistoryFromDisk();

  const items = [];
  if (searchHistory.length === 0) {
    items.push(createAction('(No previous searches)', () => {}));
  } else {
    for (const entry of searchHistory) {
      const query = String(entry?.query || '').trim();
      const provider = normalizeProvider(entry?.provider);
      if (!query) continue;
      const label = cleanLabel(`${providerTag(provider)} ${query}`, 24);
      items.push(createAction(label, () => {
        while (menuStack.depth() > 1) {
          menuStack.pop();
        }
        menuState.selectedIndex = 0;
        submitSearch(provider, query);
      }));
    }
    if (items.length === 0) {
      items.push(createAction('(No previous searches)', () => {}));
    }
  }

  menuStack.push({
    title: 'Previous',
    items,
    selectedIndex: 0
  });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openProviderMenu() {
  const items = PROVIDERS.map((provider) => createAction(provider.label, () => {
    while (menuStack.depth() > 1) {
      menuStack.pop();
    }
    menuState.selectedIndex = 0;
    if (provider.id === 'samplette') {
      searchProvider = 'samplette';
      host_module_set_param('search_provider', 'samplette');
      rebuildMenu();
      sampletteShuffle();
      return;
    }
    openSearchPrompt(provider.id);
  }));

  menuStack.push({
    title: 'Provider',
    items,
    selectedIndex: 0
  });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function sampletteApplyFilter() {
  host_module_set_param('samplette_filter', JSON.stringify(sampletteFilter));
  statusMessage = 'Filtering...';
  needsRedraw = true;
}

function sampletteShuffle() {
  host_module_set_param('samplette_auto_advance', '1');
  sampletteApplyFilter();
  statusMessage = 'Shuffling...';
  needsRedraw = true;
}

function sampletteNextTrack() {
  host_module_set_param('next_track_step', 'trigger');
  scrollOffset = 0;
  statusMessage = 'Next track...';
  needsRedraw = true;
}

function refreshFiltersMenu() {
  const current = menuStack.current();
  if (!current || current.title !== 'Filters') return;
  const genreLabel = sampletteFilter.genre.length > 0 ? sampletteFilter.genre[0] : 'All';
  const keyLabel = sampletteFilter.key.length > 0 ? sampletteFilter.key[0] : 'All';
  const tempoEntry = SAMPLETTE_TEMPOS.find(
    (t) => t.min === sampletteFilter.tempo_min && t.max === sampletteFilter.tempo_max
  );
  const tempoLabel = tempoEntry ? tempoEntry.label : 'All';

  current.items = [
    createAction(`Genre: ${genreLabel}`, () => openSampletteGenreMenu()),
    createAction(`Key: ${keyLabel}`, () => openSampletteKeyMenu()),
    createAction(`Tempo: ${tempoLabel}`, () => openSampletteTempoMenu()),
    createAction('[Apply Filters]', () => {
      while (menuStack.depth() > 1) menuStack.pop();
      menuState.selectedIndex = 0;
      sampletteShuffle();
    })
  ];
  clampSelectedIndex();
  needsRedraw = true;
}

function openSampletteGenreMenu() {
  const items = SAMPLETTE_GENRES.map((g) => {
    const current = sampletteFilter.genre.length === 0 ? 'All' : sampletteFilter.genre[0];
    const prefix = (g === current) ? '> ' : '  ';
    return createAction(`${prefix}${g}`, () => {
      sampletteFilter.genre = (g === 'All') ? [] : [g];
      menuStack.pop();
      menuState.selectedIndex = 0;
      refreshFiltersMenu();
    });
  });
  menuStack.push({ title: 'Genre', items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openSampletteKeyMenu() {
  const items = SAMPLETTE_KEYS.map((k) => {
    const current = sampletteFilter.key.length === 0 ? 'All' : sampletteFilter.key[0];
    const prefix = (k === current) ? '> ' : '  ';
    return createAction(`${prefix}${k}`, () => {
      sampletteFilter.key = (k === 'All') ? [] : [k];
      menuStack.pop();
      menuState.selectedIndex = 0;
      refreshFiltersMenu();
    });
  });
  menuStack.push({ title: 'Key', items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openSampletteTempoMenu() {
  const items = SAMPLETTE_TEMPOS.map((t) => {
    const isCurrent = sampletteFilter.tempo_min === t.min && sampletteFilter.tempo_max === t.max;
    const prefix = isCurrent ? '> ' : '  ';
    return createAction(`${prefix}${t.label}`, () => {
      sampletteFilter.tempo_min = t.min;
      sampletteFilter.tempo_max = t.max;
      menuStack.pop();
      menuState.selectedIndex = 0;
      refreshFiltersMenu();
    });
  });
  menuStack.push({ title: 'Tempo', items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openSampletteFiltersMenu() {
  const genreLabel = sampletteFilter.genre.length > 0 ? sampletteFilter.genre[0] : 'All';
  const keyLabel = sampletteFilter.key.length > 0 ? sampletteFilter.key[0] : 'All';
  const tempoEntry = SAMPLETTE_TEMPOS.find(
    (t) => t.min === sampletteFilter.tempo_min && t.max === sampletteFilter.tempo_max
  );
  const tempoLabel = tempoEntry ? tempoEntry.label : 'All';

  const items = [
    createAction(`Genre: ${genreLabel}`, () => openSampletteGenreMenu()),
    createAction(`Key: ${keyLabel}`, () => openSampletteKeyMenu()),
    createAction(`Tempo: ${tempoLabel}`, () => openSampletteTempoMenu()),
    createAction('[Apply Filters]', () => {
      while (menuStack.depth() > 1) menuStack.pop();
      menuState.selectedIndex = 0;
      sampletteShuffle();
    })
  ];
  menuStack.push({ title: 'Filters', items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function getCurrentlyPlayingResult() {
  if (searchProvider === 'samplette') {
    const idx = parseInt(host_module_get_param('samplette_result_index') || '0', 10);
    if (idx >= 0 && idx < results.length) return results[idx];
    return null;
  }
  const currentUrl = host_module_get_param('stream_url') || '';
  if (!currentUrl) return null;
  return results.find((r) => r.url === currentUrl) || null;
}

function sampletteNowPlayingLabel() {
  const r = getCurrentlyPlayingResult();
  if (!r) return null;
  const parts = [cleanLabel(r.title, 20)];
  if (r.meta_key) parts.push(`${r.meta_key}${r.meta_scale ? ' ' + r.meta_scale : ''}`);
  if (r.meta_tempo) parts.push(`${r.meta_tempo}bpm`);
  if (r.meta_genre) parts.push(cleanLabel(r.meta_genre, 14));
  return parts.join(' | ');
}

function openNowPlayingMenu() {
  const r = getCurrentlyPlayingResult();
  if (!r) {
    menuStack.push({
      title: 'Now Playing',
      items: [createAction('(Nothing playing)', () => {})],
      selectedIndex: 0
    });
    menuState.selectedIndex = 0;
    needsRedraw = true;
    return;
  }

  const noop = () => {};
  const items = [];
  items.push(createAction(r.title || '(untitled)', noop));
  if (r.channel) items.push(createAction(`By: ${r.channel}`, noop));
  if (r.duration) items.push(createAction(`Duration: ${r.duration}`, noop));
  items.push(createAction(`Source: ${providerLabel(r.provider)}`, noop));
  if (r.meta_key) {
    const keyStr = r.meta_scale ? `${r.meta_key} ${r.meta_scale}` : r.meta_key;
    items.push(createAction(`Key: ${keyStr}`, noop));
  }
  if (r.meta_tempo) items.push(createAction(`Tempo: ${r.meta_tempo} BPM`, noop));
  if (r.meta_genre) items.push(createAction(`Genre: ${r.meta_genre}`, noop));
  if (r.meta_style) items.push(createAction(`Style: ${r.meta_style}`, noop));
  if (r.meta_country) items.push(createAction(`Country: ${r.meta_country}`, noop));
  if (r.meta_year) items.push(createAction(`Year: ${r.meta_year}`, noop));

  menuStack.push({ title: 'Now Playing', items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function openSampletteHistoryMenu() {
  if (results.length === 0) {
    menuStack.push({
      title: 'History',
      items: [createAction('(No tracks yet)', () => {})],
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
    const title = cleanLabel(row?.title || `Result ${i + 1}`);
    const meta = [];
    if (row?.meta_key) meta.push(row.meta_key);
    if (row?.meta_tempo) meta.push(`${row.meta_tempo}bpm`);
    const suffix = meta.length > 0 ? ` [${meta.join(' ')}]` : '';
    items.push(
      createAction(cleanLabel(`${title}${suffix}`, 28), () => {
        if (!row || !row.url) return;
        host_module_set_param('samplette_auto_advance', '1');
        host_module_set_param('samplette_result_index', String(i));
        host_module_set_param('stream_provider', 'youtube');
        host_module_set_param('stream_url', row.url);
        while (menuStack.depth() > 1) menuStack.pop();
        menuState.selectedIndex = 0;
        statusMessage = 'Loading...';
        needsRedraw = true;
      })
    );
  }

  menuStack.push({ title: 'History', items, selectedIndex: 0 });
  menuState.selectedIndex = 0;
  needsRedraw = true;
}

function playPauseLabel() {
  if (streamStatus === 'loading' || streamStatus === 'buffering') return '[Cancel]';
  if (streamStatus === 'paused') return '[Play]';
  if (streamStatus === 'streaming') return '[Pause]';
  if ((streamStatus === 'stopped' || streamStatus === 'eof') && results.length > 0) return '[Play]';
  return '[Play/Pause]';
}

function togglePlayPause() {
  if (streamStatus === 'loading' || streamStatus === 'buffering') {
    host_module_set_param('stop_step', 'trigger');
    statusMessage = 'Cancelled';
    needsRedraw = true;
    return;
  }
  if (streamStatus === 'stopped' || streamStatus === 'eof') {
    if (results.length > 0) {
      const row = results[0];
      if (row && row.url) {
        const provider = normalizeProvider(row.provider || searchProvider);
        if (searchProvider === 'samplette') {
          host_module_set_param('samplette_auto_advance', '1');
          host_module_set_param('samplette_result_index', '0');
        }
        host_module_set_param('stream_provider', provider);
        host_module_set_param('stream_url', row.url);
        statusMessage = 'Loading...';
        needsRedraw = true;
        return;
      }
    }
  }
  host_module_set_param('play_pause_step', 'trigger');
  statusMessage = streamStatus === 'paused' ? 'Resuming...' : 'Pausing...';
  needsRedraw = true;
}

function isPlaying() {
  return streamStatus === 'streaming' || streamStatus === 'paused';
}

function buildSampletteRootItems() {
  const items = [
    createAction(playPauseLabel(), () => togglePlayPause()),
    createAction('[Shuffle]', () => sampletteShuffle())
  ];
  if (isPlaying()) {
    items.push(createAction('[Next Track]', () => sampletteNextTrack()));
    items.push(createAction('[<< 15s]', () => { host_module_set_param('rewind_15_step', 'trigger'); statusMessage = 'Rewind 15s'; needsRedraw = true; }));
    items.push(createAction('[15s >>]', () => { host_module_set_param('forward_15_step', 'trigger'); statusMessage = 'Forward 15s'; needsRedraw = true; }));
    items.push(createAction('[Now Playing...]', () => openNowPlayingMenu()));
  }
  items.push(createAction('[Filters...]', () => openSampletteFiltersMenu()));
  items.push(createAction('[History...]', () => openSampletteHistoryMenu()));

  items.push(createAction('[Change Provider...]', () => {
    clearSearchState();
    openProviderMenu();
  }));

  return items;
}

function buildRootItems() {
  if (searchProvider === 'samplette') {
    return buildSampletteRootItems();
  }

  const isLoading = streamStatus === 'loading' || streamStatus === 'buffering';
  const items = [];
  if (isPlaying()) {
    items.push(createAction(playPauseLabel(), () => togglePlayPause()));
    items.push(createAction('[<< 15s]', () => { host_module_set_param('rewind_15_step', 'trigger'); statusMessage = 'Rewind 15s'; needsRedraw = true; }));
    items.push(createAction('[15s >>]', () => { host_module_set_param('forward_15_step', 'trigger'); statusMessage = 'Forward 15s'; needsRedraw = true; }));
    items.push(createAction('[Now Playing...]', () => openNowPlayingMenu()));
  } else if (isLoading) {
    items.push(createAction(playPauseLabel(), () => togglePlayPause()));
  } else if (results.length > 0) {
    items.push(createAction(playPauseLabel(), () => togglePlayPause()));
  }
  items.push(createAction('[New Search...]', () => {
    clearSearchState();
    openProviderMenu();
  }));
  items.push(createAction('[Previous searches]', () => {
    openSearchHistoryMenu();
  }));

  const count = Math.min(results.length, MAX_MENU_RESULTS);
  for (let i = 0; i < count; i++) {
    const row = results[i];
    const rowProvider = normalizeProvider(row?.provider || searchProvider);
    const title = cleanLabel(row?.title || `Result ${i + 1}`);
    items.push(
      createAction(title, () => {
        if (!row || !row.url) return;
        host_module_set_param('stream_provider', rowProvider);
        host_module_set_param('stream_url', row.url);
        statusMessage = `Loading ${providerTag(rowProvider)} stream...`;
        needsRedraw = true;
      })
    );
  }

  return items;
}

function rebuildMenu() {
  const items = buildRootItems();
  const title = `Webstream ${providerTag(searchProvider)}`;
  if (menuStack.depth() === 0) {
    rootMenu = { title, items, selectedIndex: 0 };
    menuStack.push(rootMenu);
    menuState.selectedIndex = 0;
  } else if (rootMenu) {
    rootMenu.title = title;
    rootMenu.items = items;
    if (menuStack.depth() === 1) {
      clampSelectedIndex();
    }
  }
  needsRedraw = true;
}

function loadResults() {
  const out = [];
  const isSamplette = searchProvider === 'samplette';
  for (let i = 0; i < searchCount && i < MAX_MENU_RESULTS; i++) {
    const provider = normalizeProvider(host_module_get_param(`search_result_provider_${i}`) || searchProvider);
    const title = host_module_get_param(`search_result_title_${i}`) || '';
    const url = host_module_get_param(`search_result_url_${i}`) || '';
    const channel = host_module_get_param(`search_result_channel_${i}`) || '';
    const duration = host_module_get_param(`search_result_duration_${i}`) || '';
    const entry = { provider, title, url, channel, duration };
    if (isSamplette) {
      entry.meta_key = host_module_get_param(`search_result_key_${i}`) || '';
      entry.meta_scale = host_module_get_param(`search_result_scale_${i}`) || '';
      entry.meta_tempo = host_module_get_param(`search_result_tempo_${i}`) || '';
      entry.meta_genre = host_module_get_param(`search_result_genre_${i}`) || '';
      entry.meta_style = host_module_get_param(`search_result_style_${i}`) || '';
      entry.meta_country = host_module_get_param(`search_result_country_${i}`) || '';
      entry.meta_year = host_module_get_param(`search_result_year_${i}`) || '';
    }
    out.push(entry);
  }
  results = out;
}

function refreshState() {
  const prevSearchProvider = searchProvider;
  const prevSearchStatus = searchStatus;
  const prevSearchCount = searchCount;
  const prevStreamStatus = streamStatus;

  streamStatus = host_module_get_param('stream_status') || 'stopped';
  searchProvider = normalizeProvider(host_module_get_param('search_provider') || searchProvider);
  searchQuery = host_module_get_param('search_query') || '';
  searchStatus = host_module_get_param('search_status') || 'idle';
  searchCount = parseInt(host_module_get_param('search_count') || '0', 10) || 0;

  if (prevSearchProvider !== searchProvider || prevSearchStatus !== searchStatus || prevSearchCount !== searchCount) {
    loadResults();
    rebuildMenu();

    if (searchStatus === 'searching') {
      statusMessage = searchProvider === 'samplette' ? 'Finding tracks...' : `Searching ${providerTag(searchProvider)}...`;
    } else if (searchStatus === 'queued') {
      statusMessage = 'Search queued...';
    } else if (searchStatus === 'done') {
      if (searchProvider === 'samplette' && searchCount > 0 && prevSearchStatus !== 'done') {
        /* Auto-play first result */
        const r = results[0];
        if (r && r.url) {
          host_module_set_param('samplette_auto_advance', '1');
          host_module_set_param('samplette_result_index', '0');
          host_module_set_param('stream_provider', 'youtube');
          host_module_set_param('stream_url', r.url);
          statusMessage = 'Loading...';
        } else {
          statusMessage = 'Ready';
        }
      } else if (searchProvider === 'samplette') {
        statusMessage = 'Ready';
      } else {
        statusMessage = `${searchCount} results`;
      }
    } else if (searchStatus === 'no_results') {
      statusMessage = searchProvider === 'samplette' ? 'No tracks found' : 'No results';
    } else if (searchStatus === 'error') {
      statusMessage = 'Search failed';
    } else if (searchStatus === 'busy') {
      statusMessage = 'Search busy';
    }
  }

  if (prevStreamStatus !== streamStatus) {
    if (streamStatus === 'loading') statusMessage = 'Loading stream...';
    else if (streamStatus === 'buffering') statusMessage = 'Buffering...';
    else if (streamStatus === 'seeking') statusMessage = 'Seeking...';
    else if (streamStatus === 'paused') statusMessage = 'Paused';
    else if (streamStatus === 'streaming') statusMessage = 'Playing';
    else if (streamStatus === 'eof') statusMessage = 'Ended';
    else if (streamStatus === 'stopped') statusMessage = 'Stopped';
    rebuildMenu();
  }
}

function openSearchPrompt(providerId = searchProvider) {
  const provider = normalizeProvider(providerId);
  searchProvider = provider;
  openTextEntry({
    title: `Search ${providerTag(provider)}`,
    initialText: '',
    onConfirm: (text) => {
      const query = (text || '').trim();
      if (!query) {
        statusMessage = 'Search cancelled';
        needsRedraw = true;
        return;
      }
      submitSearch(provider, query);
    },
    onCancel: () => {
      statusMessage = 'Search cancelled';
      needsRedraw = true;
    }
  });
}

function scrollText(text, maxChars) {
  const max = maxChars || FOOTER_MAX_CHARS;
  if (!text || text.length <= max) return text;
  const padded = text + SCROLL_PAD;
  const start = scrollOffset % padded.length;
  const visible = (padded + padded).slice(start, start + max);
  return visible;
}

function nowPlayingFooter() {
  if (streamStatus !== 'streaming' && streamStatus !== 'paused') return null;
  const r = getCurrentlyPlayingResult();
  if (!r) return null;
  if (searchProvider === 'samplette') {
    return sampletteNowPlayingLabel();
  }
  const parts = [cleanLabel(r.title, 20)];
  if (r.channel) parts.push(cleanLabel(r.channel, 14));
  if (r.duration) parts.push(r.duration);
  return parts.join(' | ');
}

function currentFooter() {
  if (isTextEntryActive()) return '';
  const activity = currentActivityLabel();
  if (activity) return `${activity} ${SPINNER[spinnerFrame]}`;
  const np = nowPlayingFooter();
  if (np) {
    const time = host_module_get_param('playback_time') || '';
    if (time) {
      return { left: scrollText(np, FOOTER_MAX_CHARS_WITH_TIME), right: time };
    }
    return scrollText(np);
  }
  if (statusMessage) return statusMessage;
  return 'Click:select Back:exit';
}

globalThis.init = function () {
  searchProvider = normalizeProvider(host_module_get_param('search_provider') || 'youtube');
  searchQuery = host_module_get_param('search_query') || '';
  searchStatus = host_module_get_param('search_status') || 'idle';
  searchCount = parseInt(host_module_get_param('search_count') || '0', 10) || 0;
  streamStatus = host_module_get_param('stream_status') || 'stopped';
  selectedIndex = 0;
  statusMessage = 'Click: select';
  results = [];
  loadSearchHistoryFromDisk();
  shiftHeld = false;

  menuState = createMenuState();
  menuStack = createMenuStack();
  rootMenu = null;
  tickCounter = 0;
  spinnerTick = 0;
  spinnerFrame = 0;
  needsRedraw = true;
  pendingKnobAction = null;

  if (searchCount > 0) {
    loadResults();
    statusMessage = 'Ready';
  }
  rebuildMenu();
};

globalThis.tick = function () {
  if (isTextEntryActive()) {
    tickTextEntry();
    drawTextEntry();
    return;
  }

  tickCounter = (tickCounter + 1) % 6;
  if (tickCounter === 0) {
    refreshState();
  }

  if (currentActivityLabel()) {
    spinnerTick = (spinnerTick + 1) % 3;
    if (spinnerTick === 0) {
      spinnerFrame = (spinnerFrame + 1) % SPINNER.length;
      needsRedraw = true;
    }
  } else {
    spinnerTick = 0;
  }

  if (nowPlayingFooter()) {
    scrollTick = (scrollTick + 1) % 2;
    if (scrollTick === 0) {
      scrollOffset++;
      needsRedraw = true;
    }
  } else {
    scrollOffset = 0;
    scrollTick = 0;
  }

  if (needsRedraw) {
    const current = menuStack.current();
    if (!current) {
      rebuildMenu();
    }

    clear_screen();
    drawStackMenu({
      stack: menuStack,
      state: menuState,
      footer: currentFooter()
    });

    needsRedraw = false;
  }
};

globalThis.onMidiMessageInternal = function (data) {
  const status = data[0] & 0xF0;
  const cc = data[1];
  const val = data[2];

  if (status === MidiNoteOn && val > 0) {
    if (cc === MoveKnob1Touch) {
      setPendingKnobAction(MoveKnob1, 'play_pause', streamStatus === 'paused' ? 'Resume?' : 'Pause?');
      return;
    }
    if (cc === MoveKnob2Touch) {
      setPendingKnobAction(MoveKnob2, 'rewind_15', 'Rewind 15s?');
      return;
    }
    if (cc === MoveKnob3Touch) {
      setPendingKnobAction(MoveKnob3, 'forward_15', 'Forward 15s?');
      return;
    }
    if (cc === MoveKnob7Touch) {
      setPendingKnobAction(MoveKnob7, 'stop', 'Stop stream?');
      return;
    }
    if (cc === MoveKnob8Touch) {
      setPendingKnobAction(MoveKnob8, 'restart', 'Start over?');
      return;
    }
  }

  if (status !== 0xB0) return;

  if (cc === MoveKnob1 || cc === MoveKnob2 || cc === MoveKnob3 || cc === MoveKnob7 || cc === MoveKnob8) {
    const delta = decodeDelta(val);
    if (delta > 0 && pendingKnobAction && pendingKnobAction.cc === cc) {
      runKnobAction(pendingKnobAction.action);
      pendingKnobAction = null;
      needsRedraw = true;
    } else if (delta < 0 && pendingKnobAction && pendingKnobAction.cc === cc) {
      pendingKnobAction = null;
      statusMessage = 'Cancelled';
      needsRedraw = true;
    }
    return;
  }

  if (isCapacitiveTouchMessage(data)) return;

  if (cc === MoveShift) {
    shiftHeld = val > 0;
    return;
  }

  if (isTextEntryActive()) {
    handleTextEntryMidi(data);
    return;
  }

  const current = menuStack.current();
  if (!current) {
    rebuildMenu();
    return;
  }

  const result = handleMenuInput({
    cc,
    value: val,
    items: current.items,
    state: menuState,
    stack: menuStack,
    onBack: () => {
      host_return_to_menu();
    },
    shiftHeld
  });

  if (result.needsRedraw) {
    selectedIndex = menuState.selectedIndex;
    needsRedraw = true;
  }
};

globalThis.onMidiMessageExternal = function (data) {
  if (isTextEntryActive()) {
    handleTextEntryMidi(data);
  }
};

/* Expose chain_ui for shadow component loader compatibility. */
globalThis.chain_ui = {
  init: globalThis.init,
  tick: globalThis.tick,
  onMidiMessageInternal: globalThis.onMidiMessageInternal,
  onMidiMessageExternal: globalThis.onMidiMessageExternal
};
