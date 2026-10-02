/*
 * browser.js — Webstream's browse page: the module's FIRST page.
 *
 * An `as_page` + `enterable` + `page_first` canvas (src/chain_params.json). It
 * carries the root level's knobs (Play/Pause, -15s, +15s, Gain, Stop,
 * Restart), so they work here, in the chain editor and on the grid page that
 * follows. What is playing is the patch name the host shows in the header.
 *
 * Drawn as the HOST'S OWN LIST -- same rows, highlight, scrollbar, brackets --
 * because anything else reads as a different widget (schwung-radiogarden's
 * browser.js is the same pattern).
 *
 * The page is driven by ONE live value, the DSP's `ui_status` (its only
 * extra_key): stream and search status, provider, the results' display fields,
 * which result is playing, and download state. A canvas page cannot read
 * params on its draw path, so everything the page DRAWS comes from that; what
 * a click needs beyond it (a result's URL, its metadata) is read in the hook.
 *
 * Text comes from the host keyboard (ctx.openTextEntry -> onTextEntry), and a
 * finished download opens in the Waveform Editor via ctx.openFileInTool.
 *
 * "Entered" is inferred, as in every canvas door: the host's entering click is
 * never reported, so the first gesture that reaches onMidi proves it, and a
 * gap in draws means the page was off screen.
 */

import * as std from 'std';
import * as os from 'os';

const PROVIDERS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'freesound', label: 'FreeSound' },
  { id: 'archive', label: 'Archive.org' },
  { id: 'soundcloud', label: 'SoundCloud' },
  { id: 'cratedig', label: 'Crate Dig' },
];

const PROVIDER_TAGS = {
  youtube: '[YT]',
  freesound: '[FS]',
  archive: '[AR]',
  soundcloud: '[SC]',
  cratedig: '[CD]',
  samplette: '[SA]'
};

const CRATEDIG_GENRES = [
  'Any', 'Blues', 'Brass & Military', "Children's", 'Classical',
  'Electronic', 'Folk, World, & Country', 'Funk / Soul', 'Hip Hop',
  'Jazz', 'Latin', 'Non-Music', 'Pop', 'Reggae', 'Rock', 'Stage & Screen'
];

const CRATEDIG_STYLES = {
  'Blues': ['Any', 'Boogie Woogie', 'Chicago Blues', 'Country Blues', 'Delta Blues', 'East Coast Blues', 'Electric Blues', 'Harmonica Blues', 'Jump Blues', 'Louisiana Blues', 'Memphis Blues', 'Modern Electric Blues', 'Piano Blues', 'Piedmont Blues', 'Rhythm & Blues', 'Texas Blues'],
  'Brass & Military': ['Any', 'Brass Band', 'Marches', 'Military', 'Pipe & Drum'],
  "Children's": ['Any', 'Educational', 'Nursery Rhymes', 'Story'],
  'Classical': ['Any', 'Baroque', 'Choral', 'Classical', 'Contemporary', 'Early', 'Impressionist', 'Medieval', 'Modern', 'Neo-Classical', 'Neo-Romantic', 'Opera', 'Operetta', 'Oratorio', 'Post-Modern', 'Renaissance', 'Romantic', 'Serial', 'Twelve-tone', 'Zarzuela'],
  'Electronic': ['Any', 'Abstract', 'Acid', 'Acid House', 'Acid Jazz', 'Ambient', 'Ballroom', 'Baltimore Club', 'Bassline', 'Beatdown', 'Berlin-School', 'Big Beat', 'Breakbeat', 'Breakcore', 'Breaks', 'Broken Beat', 'Chillwave', 'Chiptune', 'Dance-pop', 'Dark Ambient', 'Darkwave', 'Deep House', 'Deep Techno', 'Disco', 'Disco Polo', 'Donk', 'Doomcore', 'Downtempo', 'Drone', 'Drum n Bass', 'Dub', 'Dub Techno', 'Dubstep', 'Dungeon Synth', 'EBM', 'Electro', 'Electro House', 'Electroclash', 'Euro House', 'Euro-Disco', 'Eurobeat', 'Eurodance', 'Experimental', 'Freestyle', 'Funkot', 'Future Jazz', 'Gabber', 'Garage House', 'Ghetto', 'Ghetto House', 'Ghettotech', 'Glitch', 'Goa Trance', 'Grime', 'Hands Up', 'Happy Hardcore', 'Hard Beat', 'Hard House', 'Hard Techno', 'Hard Trance', 'Hardcore', 'Hardstyle', 'Harsh Noise Wall', 'Hi NRG', 'Hip Hop', 'Hip-House', 'House', 'IDM', 'Illbient', 'Industrial', 'Italo House', 'Italo-Disco', 'Italodance', 'J-Core', 'Jazzdance', 'Juke', 'Jumpstyle', 'Jungle', 'Latin', 'Leftfield', 'Lento Violento', 'Makina', 'Minimal', 'Minimal Techno', 'Modern Classical', 'Musique Concrète', 'Neo Trance', 'Neofolk', 'Nerdcore Techno', 'New Age', 'New Beat', 'New Wave', 'Noise', 'Nu-Disco', 'Power Electronics', 'Progressive Breaks', 'Progressive House', 'Progressive Trance', 'Psy-Trance', 'Rhythmic Noise', 'Schranz', 'Skweee', 'Sound Collage', 'Speed Garage', 'Speedcore', 'Synth-pop', 'Synthwave', 'Tech House', 'Tech Trance', 'Techno', 'Trance', 'Tribal', 'Tribal House', 'Trip Hop', 'Tropical House', 'UK Funky', 'UK Garage', 'Vaporwave', 'Witch House'],
  'Folk, World, & Country': ['Any', 'Aboriginal', 'African', 'Andalusian Classical', 'Appalachian Music', 'Bangladeshi Classical', 'Basque Music', 'Bengali Music', 'Bhangra', 'Bluegrass', 'Cajun', 'Cambodian Classical', 'Canzone Napoletana', 'Carnatic', 'Catalan Music', 'Celtic', 'Chacarera', 'Chamamé', 'Chinese Classical', 'Chutney', 'Cobla', 'Copla', 'Country', 'Dangdut', 'Éntekhno', 'Fado', 'Filk', 'Flamenco', 'Folk', 'Funaná', 'Gagaku', 'Gamelan', 'Gospel', 'Griot', 'Guarania', 'Hawaiian', 'Highlife', 'Hillbilly', 'Hindustani', 'Honky Tonk', 'Indian Classical', 'Jota', 'Kaseko', 'Keroncong', 'Kizomba', 'Klasik', 'Klezmer', 'Korean Court Music', 'Laïkó', 'Lao Music', 'Liscio', 'Luk Krung', 'Luk Thung', 'Maloya', 'Mbalax', "Min'yō", 'Mizrahi', 'Mouth Music', 'Mugham', 'Népzene', 'Nordic', 'Ottoman Classical', 'Overtone Singing', 'Pacific', 'Pasodoble', 'Persian Classical', 'Philippine Classical', 'Phleng Phuea Chiwit', 'Piobaireachd', 'Polka', 'Progressive Bluegrass', 'Raï', 'Rebetiko', 'Romani', 'Rune Singing', 'Salegy', 'Sámi Music', 'Sea Shanties', 'Séga', 'Sephardic', 'Soukous', 'Thai Classical', 'Volksmusik', 'Waiata', 'Western Swing', 'Yemenite Jewish', 'Zamba', 'Zemer Ivri', 'Zouk', 'Zydeco'],
  'Funk / Soul': ['Any', 'Afrobeat', 'Bayou Funk', 'Boogie', 'Contemporary R&B', 'Disco', 'Free Funk', 'Funk', 'Gogo', 'Gospel', 'Minneapolis Sound', 'Neo Soul', 'New Jack Swing', 'P.Funk', 'Psychedelic', 'Rhythm & Blues', 'Soul', 'Swingbeat', 'UK Street Soul'],
  'Hip Hop': ['Any', 'Bass Music', 'Beatbox', 'Bongo Flava', 'Boom Bap', 'Bounce', 'Britcore', 'Cloud Rap', 'Conscious', 'Crunk', 'Cut-up/DJ', 'DJ Battle Tool', 'Electro', 'Favela Funk', 'G-Funk', 'Gangsta', 'Go-Go', 'Grime', 'Hardcore Hip-Hop', 'Hiplife', 'Horrorcore', 'Hyphy', 'Instrumental', 'Jazzy Hip-Hop', 'Kwaito', 'Miami Bass', 'Motswako', 'Pop Rap', 'Ragga HipHop', 'RnB/Swing', 'Screw', 'Spaza', 'Thug Rap', 'Trap', 'Trip Hop', 'Turntablism'],
  'Jazz': ['Any', 'Afro-Cuban Jazz', 'Afrobeat', 'Avant-garde Jazz', 'Big Band', 'Bop', 'Bossa Nova', 'Cape Jazz', 'Contemporary Jazz', 'Cool Jazz', 'Dixieland', 'Easy Listening', 'Free Improvisation', 'Free Jazz', 'Fusion', 'Gypsy Jazz', 'Hard Bop', 'Jazz-Funk', 'Jazz-Rock', 'Latin Jazz', 'Modal', 'Post Bop', 'Ragtime', 'Smooth Jazz', 'Soul-Jazz', 'Space-Age', 'Swing'],
  'Latin': ['Any', 'Afro-Cuban', 'Axé', 'Bachata', 'Baião', 'Batucada', 'Beguine', 'Bolero', 'Bomba', 'Boogaloo', 'Bossanova', 'Candombe', 'Carimbó', 'Cha-Cha', 'Champeta', 'Charanga', 'Choro', 'Compas', 'Conjunto', 'Corrido', 'Cuatro', 'Cubano', 'Cumbia', 'Danzon', 'Descarga', 'Forró', 'Gaita', 'Guaguancó', 'Guajira', 'Guaracha', 'Jibaro', 'Joropo', 'Lambada', 'Mambo', 'Marcha Carnavalesca', 'Mariachi', 'Marimba', 'Merengue', 'MPB', 'Musette', 'Música Criolla', 'Norteño', 'Nueva Cancion', 'Nueva Trova', 'Occitan', 'Pachanga', 'Plena', 'Porro', 'Quechua', 'Ranchera', 'Reggaeton', 'Rumba', 'Salsa', 'Samba', 'Samba-Canção', 'Seresta', 'Son', 'Son Montuno', 'Sonero', 'Tango', 'Tejano', 'Timba', 'Trova', 'Vallenato'],
  'Non-Music': ['Any', 'Audiobook', 'Comedy', 'Dialogue', 'Education', 'Field Recording', 'Health-Fitness', 'Interview', 'Monolog', 'Movie Effects', 'Poetry', 'Political', 'Promotional', 'Public Broadcast', 'Public Service Announcement', 'Radioplay', 'Religious', 'Sermon', 'Sound Art', 'Sound Poetry', 'Special Effects', 'Speech', 'Spoken Word', 'Technical', 'Therapy'],
  'Pop': ['Any', 'Ballad', 'Barbershop', 'Bollywood', 'Break-In', 'Bubblegum', 'Chanson', 'Enka', 'Ethno-pop', 'Europop', 'Indie Pop', 'J-pop', 'K-pop', 'Karaoke', 'Kayōkyoku', 'Levenslied', 'Light Music', 'Music Hall', 'Néo Kyma', 'Novelty', 'Parody', 'Schlager', 'Vocal'],
  'Reggae': ['Any', 'Azonto', 'Bubbling', 'Calypso', 'Dancehall', 'Dub', 'Dub Poetry', 'Junkanoo', 'Lovers Rock', 'Mento', 'Ragga', 'Rapso', 'Reggae', 'Reggae Gospel', 'Reggae-Pop', 'Rocksteady', 'Roots Reggae', 'Ska', 'Soca', 'Steel Band'],
  'Rock': ['Any', 'Acid Rock', 'Acoustic', 'Alternative Rock', 'AOR', 'Arena Rock', 'Art Rock', 'Atmospheric Black Metal', 'Avantgarde', 'Beat', 'Black Metal', 'Blues Rock', 'Brit Pop', 'Classic Rock', 'Coldwave', 'Country Rock', 'Crust', 'Death Metal', 'Deathcore', 'Deathrock', 'Depressive Black Metal', 'Doo Wop', 'Doom Metal', 'Dream Pop', 'Emo', 'Ethereal', 'Experimental', 'Folk Metal', 'Folk Rock', 'Funeral Doom Metal', 'Funk Metal', 'Garage Rock', 'Glam', 'Goregrind', 'Goth Rock', 'Gothic Metal', 'Grindcore', 'Grunge', 'Hard Rock', 'Hardcore', 'Heavy Metal', 'Horror Rock', 'Indie Rock', 'Industrial', 'Krautrock', 'Lo-Fi', 'Lounge', 'Math Rock', 'Melodic Death Metal', 'Melodic Hardcore', 'Metalcore', 'Mod', 'NDW', 'Neofolk', 'New Wave', 'No Wave', 'Noise', 'Noisecore', 'Nu Metal', 'Oi', 'Parody', 'Pop Punk', 'Pop Rock', 'Pornogrind', 'Post Rock', 'Post-Hardcore', 'Post-Metal', 'Post-Punk', 'Power Metal', 'Power Pop', 'Power Violence', 'Prog Rock', 'Progressive Metal', 'Psychedelic Rock', 'Psychobilly', 'Pub Rock', 'Punk', 'Rock & Roll', 'Rock Opera', 'Rockabilly', 'Shoegaze', 'Ska', 'Skiffle', 'Sludge Metal', 'Soft Rock', 'Southern Rock', 'Space Rock', 'Speed Metal', 'Stoner Rock', 'Surf', 'Swamp Pop', 'Symphonic Rock', 'Technical Death Metal', 'Thrash', 'Twist', 'Viking Metal', 'Yé-Yé'],
  'Stage & Screen': ['Any', 'Musical', 'Score', 'Soundtrack', 'Theme']
};

const CRATEDIG_DECADES = [
  'Any', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'
];

const CRATEDIG_COUNTRIES = [
  { region: null, countries: ['Any'] },
  { region: 'Americas', countries: [
    'Argentina', 'Brazil', 'Canada', 'Chile', 'Colombia', 'Cuba', 'Haiti',
    'Jamaica', 'Mexico', 'Peru', 'Puerto Rico', 'Trinidad & Tobago', 'US', 'Venezuela'
  ]},
  { region: 'Europe', countries: [
    'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Czech Republic', 'Denmark',
    'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'Ireland',
    'Italy', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Romania', 'Russia',
    'Serbia', 'Spain', 'Sweden', 'Switzerland', 'Turkey', 'UK', 'Ukraine'
  ]},
  { region: 'Africa', countries: [
    'Algeria', 'Benin', 'Cameroon', 'Cape Verde', 'Congo', 'Egypt', 'Ethiopia',
    'Ghana', 'Guinea', 'Ivory Coast', 'Kenya', 'Mali', 'Morocco', 'Nigeria',
    'Senegal', 'South Africa', 'Tanzania', 'Zimbabwe'
  ]},
  { region: 'Asia', countries: [
    'China', 'India', 'Indonesia', 'Iran', 'Israel', 'Japan', 'Lebanon',
    'Pakistan', 'Philippines', 'South Korea', 'Taiwan', 'Thailand', 'Vietnam'
  ]},
  { region: 'Oceania', countries: [
    'Australia', 'New Zealand'
  ]}
];

/* ── constants ────────────────────────────────────────────────────── */

const CC_JOG = 14;
const CC_CLICK = 3;
const SPINNER = ['-', '/', '|', '\\'];
const MAX_HISTORY = 20;
const MAX_FAVORITES = 50;

const CONFIG_DIR = '/data/UserData/schwung/config';
const HISTORY_PATH = CONFIG_DIR + '/webstream_search_history.json';
const FAVORITES_PATH = CONFIG_DIR + '/webstream_favorites.json';
const CRATEDIG_FILTER_PATH = CONFIG_DIR + '/webstream_cratedig_filter.json';

/* A page that has not been drawn for this long was not on screen. Generous on
 * purpose: a slow tick (the param channel busy, a network-heavy moment) must
 * not read as "you left", and nobody leaves and returns inside 0.6 s. */
const AWAY_MS = 600;

/* THE HOST'S LIST, exactly (list_geometry.mjs / menu_layout), shifted into
 * this page's band, which starts at screen row 9. */
const ROW_H = 9, LIST_X = 9, LIST_W = 111, LIST_Y = 1, HI_OFF = 1, VISIBLE_ROWS = 5;
const ROW_INK = 7, TRACK_X = 126;
const FRAME_X = 4, FRAME_Y = 0, FRAME_W = 120, FRAME_H = 45, ARM = 4;

/* The host face's glyph widths, space to '~' (see dr32 resample.js). */
const GLYPH_W = '51355552335525255355555555224545555555555355555555555555555353553554555553443555555555555553135';
function textW(t) {
  const s = String(t);
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    w += (c >= 32 && c <= 126 ? Number(GLYPH_W[c - 32]) : 5) + 1;
  }
  return w > 0 ? w - 1 : 0;
}

/* ASCII only (the face has nothing else), squeezed to fit `maxW` pixels. */
function fit(text, maxW) {
  let s = String(text || '').replace(/[^\x20-\x7E]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) s = '(untitled)';
  if (textW(s) <= maxW) return s;
  while (s.length > 1 && textW(s + '..') > maxW) s = s.slice(0, -1);
  return s + '..';
}

function normalizeProvider(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (!raw || raw === 'yt') return 'youtube';
  if (raw === 'fs') return 'freesound';
  if (raw === 'ia' || raw === 'archiveorg' || raw === 'internetarchive') return 'archive';
  if (raw === 'sc') return 'soundcloud';
  if (raw === 'cd') return 'cratedig';
  return raw;
}
const tagOf = (p) => PROVIDER_TAGS[normalizeProvider(p)] || '[??]';
const labelOf = (p) => (PROVIDERS.find((x) => x.id === normalizeProvider(p)) || { label: p }).label;

/* ── files (history, favorites, the Crate Dig filter) ──────────────── */

function readJson(path, fallback) {
  try {
    const raw = std.loadFile(path);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

/* Write via a temp file and rename, so a crash never leaves half a file. */
function writeJson(path, value) {
  try { os.mkdir(CONFIG_DIR); } catch (e) {}
  const tmp = path + '.tmp';
  try {
    const f = std.open(tmp, 'w');
    if (!f) return;
    f.puts(JSON.stringify(value) + '\n');
    f.close();
    if (os.rename(tmp, path) !== 0) {
      const g = std.open(path, 'w');
      if (g) { g.puts(JSON.stringify(value) + '\n'); g.close(); }
    }
  } catch (e) {}
}

/* Where older versions kept the history; read once if the current file is
 * missing, and rewritten to the current path on the next search. */
const LEGACY_HISTORY_PATHS = ['/data/UserData/schwung/webstream_search_history.json',
                              '/data/UserData/schwung/yt_search_history.json'];

function loadHistory() {
  let raw = readJson(HISTORY_PATH, null);
  for (const p of LEGACY_HISTORY_PATHS) if (raw === null) raw = readJson(p, null);
  if (raw === null) raw = [];
  const out = [];
  for (const e of Array.isArray(raw) ? raw : []) {
    const item = (typeof e === 'string') ? { provider: 'youtube', query: e }
               : (e && typeof e === 'object') ? { provider: normalizeProvider(e.provider), query: String(e.query || '').trim() }
               : null;
    if (!item || !item.query) continue;
    if (out.some((x) => x.provider === item.provider && x.query === item.query)) continue;
    out.push(item);
    if (out.length >= MAX_HISTORY) break;
  }
  return out;
}

function addHistory(provider, query) {
  const list = loadHistory().filter((x) => !(x.provider === provider && x.query === query));
  list.unshift({ provider, query });
  writeJson(HISTORY_PATH, list.slice(0, MAX_HISTORY));
}

function loadFavorites() {
  const raw = readJson(FAVORITES_PATH, []);
  return Array.isArray(raw) ? raw : [];
}

function loadDigFilter() {
  const f = readJson(CRATEDIG_FILTER_PATH, {}) || {};
  return { genre: f.genre || '', style: f.style || '', decade: f.decade || '', country: f.country || '' };
}

/* ── the live status (the page's one extra_key) ───────────────────── */

const EMPTY_STATUS = { st: 'stopped', tm: '0:00', dl: 'idle', pv: 'youtube', ss: 'idle', se: '', n: 0, pi: -1, r: [] };

function parseStatus(raw, prev) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || raw.charAt(0) !== '{') return prev || EMPTY_STATUS;
  try { return Object.assign({}, EMPTY_STATUS, JSON.parse(raw)); }
  catch (e) { return prev || EMPTY_STATUS; }
}

/* A hook reads it fresh, so a click acts on what is true now. */
function freshStatus(ctx, state) {
  state.us = parseStatus(ctx.getParam('ui_status'), state.us);
  return state.us;
}

const playing = (us) => us.st === 'streaming' || us.st === 'paused' || us.st === 'loading' ||
                        us.st === 'buffering' || us.st === 'seeking';
const busy = (us) => us.st === 'loading' || us.st === 'buffering' || us.st === 'seeking';
const isDig = (state, us) => normalizeProvider(state.provider || us.pv) === 'cratedig';

function searchNote(us) {
  if (us.ss === 'searching' || us.ss === 'queued') return 'spin';
  if (us.ss === 'no_results') return 'none';
  if (us.ss === 'busy') return 'busy';
  if (us.ss === 'error') {
    const e = String(us.se || '');
    if (e.indexOf('429') >= 0) return 'rate limited';
    if (e.indexOf('timeout') >= 0 || e.indexOf('timed out') >= 0) return 'timed out';
    if (e.indexOf('network') >= 0 || e.indexOf('urlopen') >= 0 || e.indexOf('Errno') >= 0) return 'offline';
    return 'failed';
  }
  return '';
}

function formatBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/* ── levels ────────────────────────────────────────────────────────
 *
 * A level is { kind, cursor, top, ...args }. Its ROWS are built from the level
 * and the status each time -- by the draw and by the click alike -- so what you
 * see and what a click does cannot disagree. A row is { label, suffix?, act? }:
 * no act means an info row, which a click leaves alone.
 */

function rowsFor(state, lvl, us) {
  switch (lvl.kind) {
    case 'root': return rootRows(state, us);
    case 'provider': return PROVIDERS.map((p) => ({
      label: (normalizeProvider(state.provider || us.pv) === p.id ? '> ' : '') + p.label,
      act: { kind: 'pick_provider', id: p.id } }));
    case 'history': return lvl.items.length
      ? lvl.items.map((h) => ({ label: tagOf(h.provider) + ' ' + h.query, act: { kind: 'search', provider: h.provider, query: h.query } }))
      : [{ label: '(No previous searches)' }];
    case 'favorites': return lvl.items.length
      ? lvl.items.map((f) => ({ label: f.title || f.url, act: { kind: 'play_fav', fav: f } }))
      : [{ label: '(No favorites yet)' }];
    case 'results': return resultRows(us);
    case 'now': return nowRows(state, lvl, us);
    case 'download': return downloadRows(us);
    case 'filters': {
      const f = state.dig;
      return [
        { label: 'Genre: ' + (f.genre || 'Any'), act: { kind: 'push', level: { kind: 'dig_pick', field: 'genre' } } },
        { label: 'Style: ' + (f.style || 'Any'), act: { kind: 'push', level: { kind: 'dig_pick', field: 'style' } } },
        { label: 'Decade: ' + (f.decade || 'Any'), act: { kind: 'push', level: { kind: 'dig_pick', field: 'decade' } } },
        { label: 'Country: ' + (f.country || 'Any'), act: { kind: 'push', level: { kind: 'dig_pick', field: 'country' } } },
        { label: 'Apply & Dig', act: { kind: 'dig', apply: true } },
      ];
    }
    case 'dig_pick': return digPickRows(state, lvl.field);
    default: return [];
  }
}

function resultRows(us) {
  const out = [];
  for (let i = 0; i < (us.r || []).length; i++) {
    const r = us.r[i];
    out.push({ id: 'r' + i, label: (i === us.pi ? '> ' : '') + (r.t || 'Result ' + (i + 1)),
               suffix: (i === us.pi && busy(us)) ? 'spin' : (r.d || ''),
               act: { kind: 'play_result', index: i } });
  }
  return out;
}

function rootRows(state, us) {
  const rows = [];
  const dig = isDig(state, us);
  const provider = normalizeProvider(state.provider || us.pv);
  if (dig) {
    rows.push({ id: 'dig', label: 'Dig!', suffix: searchNote(us), act: { kind: 'dig', apply: false } });
    if (playing(us)) rows.push({ id: 'next', label: 'Next track', act: { kind: 'next' } });
    rows.push({ id: 'filters', label: 'Filters', act: { kind: 'push', level: { kind: 'filters' } } });
  } else {
    rows.push({ id: 'search', label: 'Search ' + tagOf(provider), suffix: searchNote(us), act: { kind: 'prompt', provider } });
  }
  rows.push({ id: 'provider', label: 'Provider: ' + labelOf(provider), act: { kind: 'push', level: { kind: 'provider' } } });
  if (playing(us)) rows.push({ id: 'now', label: 'Now playing', suffix: busy(us) ? 'spin' : us.tm, act: { kind: 'push', level: { kind: 'now' } } });
  if (us.dl && us.dl !== 'idle') rows.push({ id: 'download', label: 'Download', suffix: us.dl === 'downloading' ? 'spin' : us.dl,
                                             act: { kind: 'push', level: { kind: 'download' } } });
  if (dig) {
    rows.push({ id: 'history', label: 'History', act: { kind: 'push', level: { kind: 'results' } } });
  } else {
    rows.push({ id: 'history', label: 'Previous searches', act: { kind: 'push', level: { kind: 'history' } } });
  }
  rows.push({ id: 'favorites', label: 'Favorites', act: { kind: 'push', level: { kind: 'favorites' } } });
  /* An ordinary search's results sit on the root, as they always have. */
  if (!dig) for (const r of resultRows(us)) rows.push(r);
  return rows;
}

function nowRows(state, lvl, us) {
  const m = lvl.meta;
  if (!m || us.pi < 0) return [{ label: '(Nothing playing)' }];
  const rows = [{ label: m.title || '(untitled)' }];
  if (m.channel) rows.push({ label: 'By: ' + m.channel });
  if (m.duration) rows.push({ label: 'Duration: ' + m.duration });
  rows.push({ label: 'Source: ' + labelOf(m.provider) });
  if (m.key) rows.push({ label: 'Key: ' + m.key + (m.scale ? ' ' + m.scale : '') });
  if (m.tempo) rows.push({ label: 'Tempo: ' + m.tempo + ' BPM' });
  if (m.genre) rows.push({ label: 'Genre: ' + m.genre });
  if (m.style) rows.push({ label: 'Style: ' + m.style });
  if (m.country) rows.push({ label: 'Country: ' + m.country });
  if (m.year) rows.push({ label: 'Year: ' + m.year });
  if (m.url) {
    rows.push({ label: lvl.fav ? 'Remove favorite' : 'Add favorite', act: { kind: 'toggle_fav' } });
    rows.push({ label: 'Download to Wave Edit', act: { kind: 'download' } });
  }
  return rows;
}

function downloadRows(us) {
  if (us.dl === 'downloading')
    return [{ label: 'Downloading', suffix: us.dp ? formatBytes(us.dp) : 'spin' }, { label: 'Cancel', act: { kind: 'dl_cancel' } }];
  if (us.dl === 'done') {
    const name = String(us.df || '').split('/').pop() || 'file';
    return [{ label: 'Saved: ' + name }, { label: 'Open in Wave Edit', act: { kind: 'open_wav', path: us.df } }];
  }
  if (us.dl === 'error') return [{ label: 'Error: ' + (us.de || 'unknown') }];
  if (us.dl === 'cancelled') return [{ label: 'Download cancelled' }];
  return [{ label: 'Starting download', suffix: 'spin' }];
}

function digPickRows(state, field) {
  const cur = state.dig[field] || 'Any';
  const opt = (v) => ({ label: (v === cur ? '> ' : '') + v, act: { kind: 'dig_set', field, value: v } });
  if (field === 'genre') return CRATEDIG_GENRES.map(opt);
  if (field === 'decade') return CRATEDIG_DECADES.map(opt);
  if (field === 'style') {
    const g = state.dig.genre;
    return ((g && CRATEDIG_STYLES[g]) || ['Any']).map(opt);
  }
  const rows = [];
  for (const group of CRATEDIG_COUNTRIES) {
    if (group.region) rows.push({ label: '-- ' + group.region + ' --' });
    for (const c of group.countries) rows.push(opt(c));
  }
  return rows;
}

/* ── state (per slot: the host hands the same object to hooks and draw) ── */

function stateOf(state) {
  if (!state.ready) {
    state.ready = true;
    state.entered = false;
    state.lastDraw = -1;
    state.stack = [{ kind: 'root', cursor: 0, top: 0 }];
    state.us = EMPTY_STATUS;
    state.provider = '';           /* the provider picked here, before a search sends it */
    state.dig = loadDigFilter();
  }
  return state;
}

const cur = (state) => state.stack[state.stack.length - 1];

function push(state, level) {
  state.stack.push(Object.assign({ cursor: 0, top: 0 }, level));
}

/*
 * The cursor follows a ROW, not a position: rows come and go with the status
 * (Now playing appears when a track starts), and a cursor kept as an index
 * would slide onto whatever moved under it -- you click a result and the
 * highlight lands on Favorites. So the level remembers the row's id and finds
 * it again whenever the rows are rebuilt.
 */
const rowId = (row) => (row && (row.id || row.label)) || '';
function followCursor(lvl, rows) {
  if (lvl.curId && rowId(rows[lvl.cursor]) !== lvl.curId) {
    const at = rows.findIndex((r) => rowId(r) === lvl.curId);
    if (at >= 0) lvl.cursor = at;
  }
  clampCursor(lvl, rows.length);
  lvl.curId = rowId(rows[lvl.cursor]);
}

function clampCursor(lvl, n) {
  if (lvl.cursor >= n) lvl.cursor = Math.max(0, n - 1);
  if (lvl.cursor < lvl.top) lvl.top = lvl.cursor;
  if (lvl.cursor >= lvl.top + VISIBLE_ROWS) lvl.top = lvl.cursor - VISIBLE_ROWS + 1;
  if (lvl.top > Math.max(0, n - VISIBLE_ROWS)) lvl.top = Math.max(0, n - VISIBLE_ROWS);
}

/* ── actions (hooks only: they may read and set params) ───────────── */

function playUrl(ctx, provider, url) {
  if (!url) return;
  ctx.setParam('stream_provider', normalizeProvider(provider));
  ctx.setParam('stream_url', url);
}

function submitSearch(ctx, state, provider, query) {
  const p = normalizeProvider(provider);
  const q = String(query || '').trim();
  if (!q) return;
  addHistory(p, q);
  state.provider = p;
  ctx.setParam('search_provider', p);
  ctx.setParam('search_query', q);
  state.stack = [{ kind: 'root', cursor: 0, top: 0 }];
}

function dig(ctx, state) {
  writeJson(CRATEDIG_FILTER_PATH, state.dig);
  state.provider = 'cratedig';
  ctx.setParam('search_provider', 'cratedig');
  ctx.setParam('cratedig_auto_advance', '1');
  ctx.setParam('cratedig_filter', JSON.stringify(state.dig));
  state.stack = [{ kind: 'root', cursor: 0, top: 0 }];
}

/* The playing result's full record, read when Now Playing opens. */
function readPlayingMeta(ctx, us) {
  const i = us.pi;
  if (i < 0) return null;
  const g = (k) => ctx.getParam('search_result_' + k + '_' + i) || '';
  return { title: g('title'), channel: g('channel'), duration: g('duration'), url: g('url'),
           provider: g('provider') || us.pv, key: g('key'), scale: g('scale'), tempo: g('tempo'),
           genre: g('genre'), style: g('style'), country: g('country'), year: g('year') };
}

function act(ctx, state, a) {
  const us = state.us;
  switch (a.kind) {
    case 'prompt':
      ctx.openTextEntry({ title: 'Search ' + tagOf(a.provider), initial: '' });
      state.pendingProvider = a.provider;
      return;
    case 'search': submitSearch(ctx, state, a.provider, a.query); return;
    case 'push': {
      const lvl = Object.assign({}, a.level);
      if (lvl.kind === 'history') lvl.items = loadHistory();
      if (lvl.kind === 'favorites') lvl.items = loadFavorites().slice(0, MAX_FAVORITES);
      if (lvl.kind === 'now') {
        lvl.meta = readPlayingMeta(ctx, us);
        /* Read once here, not per frame: the draw builds these rows. */
        lvl.fav = !!(lvl.meta && lvl.meta.url && loadFavorites().some((f) => f.url === lvl.meta.url));
      }
      push(state, lvl);
      return;
    }
    case 'pick_provider':
      state.stack.pop();
      /* Land on the new top row (Search, or Dig!), as the old UI did. */
      cur(state).cursor = 0; cur(state).top = 0; cur(state).curId = '';
      if (a.id === 'cratedig') {
        state.provider = 'cratedig';
        ctx.setParam('search_provider', 'cratedig');
        return;
      }
      state.provider = a.id;
      ctx.openTextEntry({ title: 'Search ' + tagOf(a.id), initial: '' });
      state.pendingProvider = a.id;
      return;
    case 'play_result': {
      const i = a.index;
      const url = ctx.getParam('search_result_url_' + i) || '';
      const provider = ctx.getParam('search_result_provider_' + i) || us.pv;
      if (isDig(state, us)) {
        ctx.setParam('cratedig_auto_advance', '1');
        ctx.setParam('cratedig_result_index', String(i));
        playUrl(ctx, 'youtube', url);
      } else {
        playUrl(ctx, provider, url);
      }
      return;
    }
    case 'play_fav': playUrl(ctx, a.fav.provider || 'youtube', a.fav.url); return;
    case 'next': ctx.setParam('next_track_step', 'trigger'); return;
    case 'dig': if (a.apply) state.stack = [{ kind: 'root', cursor: 0, top: 0 }]; dig(ctx, state); return;
    case 'dig_set':
      state.dig[a.field] = (a.value === 'Any') ? '' : a.value;
      if (a.field === 'genre') state.dig.style = '';
      state.stack.pop();
      return;
    case 'toggle_fav': {
      const m = cur(state).meta;
      if (!m || !m.url) return;
      const favs = loadFavorites();
      const at = favs.findIndex((f) => f.url === m.url);
      if (at >= 0) favs.splice(at, 1);
      else favs.unshift({ url: m.url, title: m.title, channel: m.channel, provider: m.provider,
                          meta_genre: m.genre, meta_year: m.year });
      writeJson(FAVORITES_PATH, favs);
      cur(state).fav = at < 0;
      return;
    }
    case 'download': {
      const m = cur(state).meta;
      if (us.dl !== 'downloading') ctx.setParam('download_wav', (m && (m.title || m.channel)) || 'webstream');
      state.stack.pop();
      push(state, { kind: 'download' });
      return;
    }
    case 'dl_cancel': ctx.setParam('download_cancel', 'trigger'); return;
    case 'open_wav': if (a.path) ctx.openFileInTool(a.path, 'waveform-editor'); return;
    default: return;
  }
}

/* ── drawing ──────────────────────────────────────────────────────── */

function drawBrackets(ctx) {
  const x = FRAME_X, y = FRAME_Y, w = FRAME_W, h = FRAME_H;
  for (let i = 0; i < ARM; i++) {
    ctx.fillRect(x + i, y, 1, 1, 1);
    ctx.fillRect(x + w - 1 - i, y, 1, 1, 1);
    ctx.fillRect(x + i, y + h - 1, 1, 1, 1);
    ctx.fillRect(x + w - 1 - i, y + h - 1, 1, 1, 1);
  }
  for (let i = 0; i < ARM - 1; i++) {
    ctx.fillRect(x, y + i, 1, 1, 1);
    ctx.fillRect(x + w - 1, y + i, 1, 1, 1);
    ctx.fillRect(x, y + h - 1 - i, 1, 1, 1);
    ctx.fillRect(x + w - 1, y + h - 1 - i, 1, 1, 1);
  }
}

/*
 * ONE picture for both states, so entering is visible: the click that enters
 * this door is the host's and nothing reports it. Un-entered and entered are
 * the same list and differ the way the host's own list doors do: brackets
 * un-entered, the row highlight entered.
 */
function drawPageBody(ctx, state, nowMs) {
  const lvl = cur(state);
  const rows = rowsFor(state, lvl, state.us);
  followCursor(lvl, rows);
  const spin = SPINNER[Math.floor(nowMs / 150) % SPINNER.length];
  for (let i = 0; i < VISIBLE_ROWS; i++) {
    const r = lvl.top + i;
    if (r >= rows.length) break;
    const y = LIST_Y + i * ROW_H;
    const on = state.entered && r === lvl.cursor;
    if (on) ctx.fillRect(0, y - HI_OFF, 128, ROW_H, 1);
    const sfx = rows[r].suffix === 'spin' ? spin : (rows[r].suffix || '');
    const label = sfx ? fit(rows[r].label, LIST_W - textW(' ' + sfx)) + ' ' + sfx
                      : fit(rows[r].label, LIST_W);
    ctx.print(LIST_X, y, label, on ? 0 : 1);
  }
  if (lvl.top > 0 || lvl.top + VISIBLE_ROWS < rows.length) {
    const trackBottom = LIST_Y + (VISIBLE_ROWS - 1) * ROW_H + ROW_INK;
    const trackH = trackBottom - LIST_Y;
    for (let y = LIST_Y; y < trackBottom; y += 2) ctx.fillRect(TRACK_X, y, 1, 1, 1);
    const thumbH = Math.max(2, Math.round((VISIBLE_ROWS / rows.length) * trackH));
    const maxStart = rows.length - VISIBLE_ROWS;
    const ty = LIST_Y + (maxStart > 0 ? Math.round((lvl.top / maxStart) * (trackH - thumbH)) : 0);
    ctx.fillRect(TRACK_X, ty, 1, thumbH, 1);
  }
  if (!state.entered) drawBrackets(ctx);
}

/* ── the overlay ──────────────────────────────────────────────────── */

globalThis.canvas_overlay = {
  onMidi(ctx, msg) {
    const d = msg && msg.data;
    if (!d || d.length < 3 || (d[0] & 0xF0) !== 0xB0) return;
    const state = stateOf(ctx.state);
    /* Only an ENTERED door is handed gestures: this one proves it. */
    const wasEntered = state.entered;
    state.entered = true;
    if (wasEntered) {
      const us = freshStatus(ctx, state);
      const lvl = cur(state);
      const rows = rowsFor(state, lvl, us);
      followCursor(lvl, rows);
      if (d[1] === CC_JOG) {
        const v = d[2];
        const delta = v === 0 ? 0 : (v <= 63 ? v : -(128 - v));
        if (delta) {
          lvl.cursor += delta > 0 ? 1 : -1;
          if (lvl.cursor < 0) lvl.cursor = 0;
          clampCursor(lvl, rows.length);
          lvl.curId = rowId(rows[lvl.cursor]);
        }
      } else if (d[1] === CC_CLICK && d[2] > 0) {
        const row = rows[lvl.cursor];
        if (row && row.act) act(ctx, state, row.act);
      }
    }
    /* A hook call proves the page is on screen (a click may block briefly). */
    state.lastDraw = Date.now();
  },

  /* The keyboard's answer (ctx.openTextEntry). */
  onTextEntry(ctx, p) {
    const state = stateOf(ctx.state);
    const provider = state.pendingProvider || state.provider || state.us.pv;
    state.pendingProvider = null;
    if (p && !p.cancelled && String(p.text || '').trim()) submitSearch(ctx, state, provider, p.text);
    state.lastDraw = Date.now();
  },

  /* true = "I went up a level, keep me here"; anything else = leave the door. */
  handleBack(ctx) {
    const state = stateOf(ctx.state);
    if (state.stack.length > 1) { state.stack.pop(); return true; }
    state.entered = false;
    return false;
  },

  drawPage(ctx, info) {
    const state = stateOf(info.state || {});
    const nowMs = typeof info.nowMs === 'number' ? info.nowMs : Date.now();
    if (state.lastDraw < 0 || nowMs - state.lastDraw > AWAY_MS) state.entered = false;
    state.lastDraw = nowMs;
    if (info.values && info.values.ui_status !== undefined)
      state.us = parseStatus(info.values.ui_status, state.us);
    drawPageBody(ctx, state, nowMs);
  },
};
