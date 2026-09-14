/* Shared helpers and translations. Indonesian is the default. */

const STRINGS = {
  id: {
    brand: 'Turnamen',
    switchLang: 'English',
    playerTitle: 'Cek meja kamu',
    playerIntro: 'Masukkan nama dan kode yang diberikan panitia.',
    eventCode: 'Kode turnamen',
    yourName: 'Nama kamu',
    yourCode: 'Kode kamu',
    check: 'Cek',
    checking: 'Mencari…',
    tableCaption: 'Meja kamu',
    round: 'Ronde',
    versus: 'Lawan kamu',
    byeTitle: 'Bye',
    byeBody: 'Kamu tidak bertanding ronde ini dan otomatis menang.',
    noMatch: 'Belum ada pairing untuk ronde ini. Coba lagi sebentar lagi.',
    rank: 'Peringkat',
    points: 'Poin',
    record: 'W–L–D',
    reportTitle: 'Lapor hasil',
    reportIntro: 'Lapor hasilmu, lalu panitia akan mengonfirmasi.',
    win: 'Menang',
    loss: 'Kalah',
    draw: 'Seri',
    reported: 'Hasil terkirim. Menunggu konfirmasi panitia.',
    confirmedMsg: 'Hasil sudah dikonfirmasi panitia.',
    refresh: 'Muat ulang',
    standings: 'Klasemen',
    pairings: 'Pairing',
    player: 'Pemain',
    dropped: 'Mundur',
    notFound: 'Nama atau kode tidak cocok. Cek lagi dengan panitia.',
    autoRefresh: 'Diperbarui otomatis',
    organizer: 'Panitia',
    backToLookup: 'Kembali',
    allTournaments: 'Semua turnamen',
    listIntro: 'Pilih turnamen untuk melihat klasemen dan pairing.',
    searchTournament: 'Cari turnamen',
    noTournaments: 'Belum ada turnamen.',
    roundsWord: 'ronde',
    playersWord: 'pemain',
    status_setup: 'pendaftaran',
    status_swiss: 'berlangsung',
    status_cut: 'top cut',
    status_done: 'selesai',
    checkIn: 'Cari nama kamu',
    checkInIntro: 'Ketik nama atau PTCG ID kamu.',
    nameOrId: 'Nama atau PTCG ID',
    noPlayerFound: 'Nama tidak ditemukan. Cek dengan panitia.',
    noEvent: 'Turnamen tidak ditemukan.',
    viewStandings: 'Lihat klasemen',
    reportingClosed: 'Lapor mandiri ditutup. Beri tahu panitia hasilmu.',
    notYou: 'Bukan kamu?',
    tabStandings: 'Klasemen',
    tabRounds: 'Ronde',
    tabPlayers: 'Pemain',
    tabTopCut: 'Top Cut',
    playerPortal: 'Portal pemain',
    table: 'Meja',
    opponent: 'Lawan',
    result: 'Hasil',
    downloadCsv: 'Unduh CSV',
    tiebreakNote: 'Menang = 3 poin · Seri = 1 poin · Kalah = 0 poin',
    tiebreakNoteDl: 'Menang = 3 poin · Kalah ganda = 0 poin untuk keduanya · Kalah = 0 poin',
    noRounds: 'Belum ada ronde.',
    noTopCut: 'Belum ada top cut.',
    scanToCheckIn: 'Pindai untuk cek meja kamu',
    codePrompt: 'Kode kamu (4 huruf dari panitia)',
    codeHelp: 'Kode ini ada di slip yang diberikan panitia. Hanya diperlukan saat melapor hasil.',
    codeMissing: 'Masukkan kode kamu dulu.',
    topCutLabel: 'Top Cut',
    cutRound: 'Babak',
    doubleLoss: 'Kalah ganda',
    tieHandling: 'Hasil seri',
    tieAsDraw: 'Seri — 1 poin untuk keduanya',
    tieAsDoubleLoss: 'Kalah ganda — 0 poin untuk keduanya',
    roundTimer: 'Timer ronde',
    timerPaused: 'dijeda',
    timeUp: 'Waktu habis',
    roundConfirmed: 'Ronde dikonfirmasi',
    roundOpen: 'Ronde belum dikonfirmasi',
    themeLight: 'Mode terang',
    themeDark: 'Mode gelap',
  },
  en: {
    brand: 'Tournament',
    switchLang: 'Bahasa Indonesia',
    playerTitle: 'Find your table',
    playerIntro: 'Enter the name and code the organizer gave you.',
    eventCode: 'Tournament code',
    yourName: 'Your name',
    yourCode: 'Your code',
    check: 'Check',
    checking: 'Looking up…',
    tableCaption: 'Your table',
    round: 'Round',
    versus: 'Your opponent',
    byeTitle: 'Bye',
    byeBody: 'You have no match this round and are awarded the win.',
    noMatch: 'No pairing yet for this round. Check again shortly.',
    rank: 'Rank',
    points: 'Points',
    record: 'W–L–D',
    reportTitle: 'Report your result',
    reportIntro: 'Report your result, then the organizer confirms it.',
    win: 'Win',
    loss: 'Loss',
    draw: 'Draw',
    reported: 'Result sent. Waiting for the organizer to confirm.',
    confirmedMsg: 'The organizer has confirmed this result.',
    refresh: 'Refresh',
    standings: 'Standings',
    pairings: 'Pairings',
    player: 'Player',
    dropped: 'Dropped',
    notFound: 'That name and code do not match. Check with the organizer.',
    autoRefresh: 'Updates automatically',
    organizer: 'Organizer',
    backToLookup: 'Back',
    allTournaments: 'All tournaments',
    listIntro: 'Pick a tournament to see standings and pairings.',
    searchTournament: 'Search tournaments',
    noTournaments: 'No tournaments yet.',
    roundsWord: 'rounds',
    playersWord: 'players',
    status_setup: 'registration',
    status_swiss: 'active',
    status_cut: 'top cut',
    status_done: 'completed',
    checkIn: 'Find your name',
    checkInIntro: 'Type your name or PTCG ID.',
    nameOrId: 'Name or PTCG ID',
    noPlayerFound: 'No match. Check with the organizer.',
    noEvent: 'Tournament not found.',
    viewStandings: 'View standings',
    reportingClosed: 'Self-reporting is off. Tell the organizer your result.',
    notYou: 'Not you?',
    tabStandings: 'Standings',
    tabRounds: 'Rounds',
    tabPlayers: 'Players',
    tabTopCut: 'Top Cut',
    playerPortal: 'Player portal',
    table: 'Table',
    opponent: 'Opponent',
    result: 'Result',
    downloadCsv: 'Download CSV',
    tiebreakNote: 'Win = 3 pts · Draw = 1 pt · Loss = 0 pts',
    tiebreakNoteDl: 'Win = 3 pts · Double loss = 0 pts for both · Loss = 0 pts',
    noRounds: 'No rounds yet.',
    noTopCut: 'No top cut yet.',
    scanToCheckIn: 'Scan to find your table',
    codePrompt: 'Your code (4 letters, from the organizer)',
    codeHelp: 'The code is on the slip the organizer gave you. Only needed to report a result.',
    codeMissing: 'Enter your code first.',
    topCutLabel: 'Top Cut',
    cutRound: 'Round',
    doubleLoss: 'Double loss',
    tieHandling: 'Ties',
    tieAsDraw: 'Draw — 1 point each',
    tieAsDoubleLoss: 'Double loss — 0 points each',
    roundTimer: 'Round timer',
    timerPaused: 'paused',
    timeUp: 'Time',
    roundConfirmed: 'Round confirmed',
    roundOpen: 'Round not confirmed yet',
    themeLight: 'Light mode',
    themeDark: 'Dark mode',
  },
};

let LANG = localStorage.getItem('onic-lang') || 'id';

function t(key) {
  return (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
}

function setLang(lang) {
  LANG = lang;
  localStorage.setItem('onic-lang', lang);
  document.documentElement.lang = lang;
  if (typeof render === 'function') render();
  applyStaticText();
  applyTheme(); // the switch's own label is translated too
}

function toggleLang() {
  setLang(LANG === 'id' ? 'en' : 'id');
}

function applyStaticText() {
  document.querySelectorAll('[data-t]').forEach((el) => {
    el.textContent = t(el.dataset.t);
  });
  document.querySelectorAll('[data-t-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.tPh);
  });
}

// ------------------------------------------------------------------ theme ---

/*
 * Three states, matching the CSS: 'light', 'dark', or nothing stored, which
 * means follow the device. Only an explicit choice stamps data-theme, so a
 * reader who has never touched the switch keeps tracking their system setting
 * even if it changes while the page is open.
 */
function storedTheme() {
  try {
    const v = localStorage.getItem('onic-theme');
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // private windows and blocked site data both land here
  }
}

function currentTheme() {
  const stored = storedTheme();
  if (stored) return stored;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  const stored = storedTheme();
  if (stored) document.documentElement.setAttribute('data-theme', stored);
  else document.documentElement.removeAttribute('data-theme');
  const dark = currentTheme() === 'dark';
  document.querySelectorAll('[data-theme-toggle]').forEach((node) => {
    // A page with no language switch of its own (the organizer console) carries
    // its own labels rather than following the player-facing language.
    const own = dark ? node.dataset.labelLight : node.dataset.labelDark;
    node.textContent = own || (dark ? t('themeLight') : t('themeDark'));
  });
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('onic-theme', next);
  } catch { /* the choice just does not persist */ }
  applyTheme();
}

applyTheme();

// ------------------------------------------------------------------ clock ---

/*
 * The server sends the instant a round ends, plus its own clock. Taking the
 * difference between the two once, at load, means a device whose clock is
 * minutes out still shows the same countdown as everyone else in the room.
 */
let CLOCK_SKEW_MS = 0;

function noteServerTime(serverNow) {
  if (!serverNow) return;
  const skew = new Date(serverNow).getTime() - Date.now();
  if (Number.isFinite(skew)) CLOCK_SKEW_MS = skew;
}

/** Milliseconds left on a timer payload, or null if the event has no clock. */
function timerLeft(timer) {
  if (!timer) return null;
  if (!timer.running) return Math.max(0, timer.leftMs || 0);
  if (!timer.endsAt) return null;
  return Math.max(0, new Date(timer.endsAt).getTime() - (Date.now() + CLOCK_SKEW_MS));
}

function clockText(ms) {
  if (ms === null || ms === undefined) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Paint one clock node from a timer payload. Safe to call every second. */
function paintClock(node, timer) {
  const ms = timerLeft(timer);
  node.textContent = ms === 0 ? t('timeUp') : clockText(ms);
  node.className = 'clock' +
    (!timer || !timer.running ? ' paused' : '') +
    (ms !== null && ms === 0 ? ' over' : ms !== null && ms <= 5 * 60000 ? ' low' : '');
  node.title = timer && !timer.running ? t('timerPaused') : '';
}

// ------------------------------------------------------------------ utils ---

function $(sel, root) {
  return (root || document).querySelector(sel);
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children || [])) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

async function api(method, path, body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function pct(value) {
  return value === null || value === undefined ? '—' : (value * 100).toFixed(2) + '%';
}

/*
 * W–L–D, or plain W–L when the event scores ties as a double loss — there are
 * no draws to show in that mode, and an empty third column reads as a bug.
 */
function recordText(row, settings) {
  if (settings && settings.tieMode === 'doubleLoss') return `${row.wins}–${row.losses}`;
  const parts = [row.wins, row.losses];
  if (row.draws) parts.push(row.draws);
  return parts.join('–');
}

function recordHead(settings) {
  return settings && settings.tieMode === 'doubleLoss' ? 'W–L' : 'W–L–D';
}

function showNote(node, message, kind) {
  node.textContent = message || '';
  node.className = 'note' + (kind ? ' ' + kind : '');
}
