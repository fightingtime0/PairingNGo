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

function recordText(row) {
  const parts = [row.wins, row.losses];
  if (row.draws) parts.push(row.draws);
  return parts.join('–');
}

function showNote(node, message, kind) {
  node.textContent = message || '';
  node.className = 'note' + (kind ? ' ' + kind : '');
}
