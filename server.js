'use strict';

/*
 * Onic TCG tournament server.
 * Node built-ins only — no npm install, nothing to keep updated.
 *
 *   node server.js            listens on port 3000
 *   PORT=8080 node server.js  listens on 8080
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const swiss = require('./lib/swiss');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- storage ---

// Codes skip characters that get misread on a printed slip: 0/O, 1/I/L, 5/S, 2/Z.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';

function makeCode(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function tournamentPath(id) {
  if (!/^[A-Z0-9]{4,10}$/.test(id)) throw new Error('Bad tournament id');
  return path.join(DATA_DIR, `${id}.json`);
}

/**
 * Write to a temp file then rename. Rename is atomic on the same filesystem,
 * so a crash mid-write can never leave a half-written tournament on disk.
 */
async function saveTournament(t) {
  t.updatedAt = new Date().toISOString();
  const target = tournamentPath(t.id);
  const temp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(t, null, 2), 'utf8');
  await fsp.rename(temp, target);
}

async function loadTournament(id) {
  try {
    const raw = await fsp.readFile(tournamentPath(id), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function listTournaments() {
  const files = await fsp.readdir(DATA_DIR);
  const out = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const t = JSON.parse(await fsp.readFile(path.join(DATA_DIR, file), 'utf8'));
      out.push({
        id: t.id,
        name: t.name,
        status: t.status,
        players: t.players.length,
        rounds: t.rounds.length,
        totalRounds: t.settings.rounds,
        createdAt: t.createdAt,
      });
    } catch {
      /* skip unreadable file rather than take the whole list down */
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

// Serialise writes per tournament so two organizer clicks can't interleave.
const locks = new Map();
function withLock(id, fn) {
  const previous = locks.get(id) || Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(
    id,
    next.catch(() => {})
  );
  return next;
}

// ------------------------------------------------------------------- auth ---

function hashSecret(secret, salt) {
  return crypto.scryptSync(secret, salt, 32).toString('hex');
}

function checkAdmin(t, token) {
  if (!token) return false;
  const expected = Buffer.from(t.adminToken);
  const given = Buffer.from(String(token));
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

function normalise(str) {
  return String(str || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findPlayer(t, name, code) {
  const wantName = normalise(name);
  const wantCode = String(code || '').trim().toUpperCase();
  return t.players.find((p) => normalise(p.name) === wantName && p.code === wantCode) || null;
}

// ------------------------------------------------------------------ views ---

/** Everything a player or spectator may see. No player codes leave this. */
function publicView(t) {
  const standings = swiss.computeStandings(t);
  const nameOf = new Map(t.players.map((p) => [p.id, p.name]));

  const round = t.rounds[t.rounds.length - 1] || null;
  const pairings = round
    ? round.matches.map((m) => ({
        id: m.id,
        table: m.table,
        bye: m.bye,
        p1: nameOf.get(m.p1) || '?',
        p2: m.bye ? null : nameOf.get(m.p2) || '?',
        status: m.status,
        result: m.status === 'confirmed' ? m.result : null,
      }))
    : [];

  return {
    id: t.id,
    name: t.name,
    status: t.status,
    settings: { rounds: t.settings.rounds, allowDraws: t.settings.allowDraws, topCut: t.settings.topCut },
    currentRound: round ? round.number : 0,
    pairings,
    standings: standings.map((r) => ({
      rank: r.rank,
      name: r.name,
      points: r.points,
      wins: r.wins,
      losses: r.losses,
      draws: r.draws,
      byes: r.byes,
      dropped: r.dropped,
      opWinPct: r.opWinPct,
      opOpWinPct: r.opOpWinPct,
    })),
    cut: t.cut
      ? {
          size: t.cut.size,
          rounds: t.cut.rounds.map((r) => ({
            number: r.number,
            matches: r.matches.map((m) => ({
              id: m.id,
              table: m.table,
              p1: nameOf.get(m.p1) || '?',
              p2: nameOf.get(m.p2) || '?',
              status: m.status,
              result: m.status === 'confirmed' ? m.result : null,
            })),
          })),
        }
      : null,
    updatedAt: t.updatedAt,
  };
}

/** Organizer view: adds player codes and the pending-result queue. */
function adminView(t) {
  const base = publicView(t);
  const nameOf = new Map(t.players.map((p) => [p.id, p.name]));
  const round = t.rounds[t.rounds.length - 1] || null;

  return {
    ...base,
    players: t.players.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      dropped: !!p.dropped,
      arrivedLate: !!p.arrivedLate,
    })),
    round: round
      ? {
          number: round.number,
          hadRematch: !!round.hadRematch,
          matches: round.matches.map((m) => ({
            id: m.id,
            table: m.table,
            bye: m.bye,
            p1: nameOf.get(m.p1) || '?',
            p2: m.bye ? null : nameOf.get(m.p2) || '?',
            p1Id: m.p1,
            p2Id: m.p2,
            result: m.result,
            status: m.status,
            reportedBy: m.reportedBy ? nameOf.get(m.reportedBy) : null,
          })),
        }
      : null,
  };
}

function currentMatchFor(t, playerId) {
  const round = t.rounds[t.rounds.length - 1];
  if (!round) return { round: null, match: null };
  const match = round.matches.find((m) => m.p1 === playerId || m.p2 === playerId);
  return { round, match: match || null };
}

// -------------------------------------------------------------- handlers ---

const routes = [];
function route(method, pattern, handler) {
  routes.push({ method, pattern, handler });
}

route('POST', /^\/api\/tournaments$/, async (req, res, body) => {
  const name = String(body.name || '').trim();
  if (!name) return send(res, 400, { error: 'Tournament name is required.' });

  const rounds = Number(body.rounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
    return send(res, 400, { error: 'Rounds must be a whole number from 1 to 20.' });
  }

  let id;
  do {
    id = makeCode(5);
  } while (fs.existsSync(path.join(DATA_DIR, `${id}.json`)));

  const password = String(body.password || '').trim();
  if (password.length < 4) {
    return send(res, 400, { error: 'Organizer password must be at least 4 characters.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');

  const t = {
    id,
    name,
    createdAt: new Date().toISOString(),
    status: 'setup',
    settings: {
      rounds,
      allowDraws: body.allowDraws !== false,
      topCut: Number(body.topCut) || 0,
      language: body.language === 'en' ? 'en' : 'id',
    },
    passwordSalt: salt,
    passwordHash: hashSecret(password, salt),
    adminToken: crypto.randomBytes(24).toString('hex'),
    players: [],
    rounds: [],
    cut: null,
  };

  await saveTournament(t);
  send(res, 200, { id: t.id, adminToken: t.adminToken, name: t.name });
});

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/login$/, async (req, res, body, [id]) => {
  const t = await loadTournament(id);
  if (!t) return send(res, 404, { error: 'No tournament with that code.' });
  const given = hashSecret(String(body.password || ''), t.passwordSalt);
  const ok =
    given.length === t.passwordHash.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(t.passwordHash));
  if (!ok) return send(res, 401, { error: 'Wrong password.' });
  send(res, 200, { id: t.id, adminToken: t.adminToken, name: t.name });
});

route('GET', /^\/api\/tournaments$/, async (req, res) => {
  send(res, 200, { tournaments: await listTournaments() });
});

route('GET', /^\/api\/tournaments\/([A-Z0-9]+)$/, async (req, res, body, [id], query, headers) => {
  const t = await loadTournament(id);
  if (!t) return send(res, 404, { error: 'No tournament with that code.' });
  const token = (headers.authorization || '').replace(/^Bearer\s+/i, '');
  send(res, 200, checkAdmin(t, token) ? adminView(t) : publicView(t));
});

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/lookup$/, async (req, res, body, [id]) => {
  const t = await loadTournament(id);
  if (!t) return send(res, 404, { error: 'No tournament with that code.' });

  const player = findPlayer(t, body.name, body.code);
  if (!player) return send(res, 404, { error: 'No player found with that name and code.' });

  const standings = swiss.computeStandings(t);
  const row = standings.find((r) => r.id === player.id);
  const { round, match } = currentMatchFor(t, player.id);
  const nameOf = new Map(t.players.map((p) => [p.id, p.name]));

  send(res, 200, {
    player: { id: player.id, name: player.name, dropped: !!player.dropped },
    tournament: { id: t.id, name: t.name, status: t.status, allowDraws: t.settings.allowDraws },
    record: row
      ? {
          rank: row.rank,
          points: row.points,
          wins: row.wins,
          losses: row.losses,
          draws: row.draws,
          byes: row.byes,
          opWinPct: row.opWinPct,
          opOpWinPct: row.opOpWinPct,
          total: standings.length,
        }
      : null,
    match: match
      ? {
          id: match.id,
          round: round.number,
          table: match.table,
          bye: match.bye,
          opponent: match.bye ? null : nameOf.get(match.p1 === player.id ? match.p2 : match.p1),
          isP1: match.p1 === player.id,
          status: match.status,
          result: match.result,
          reportedByMe: match.reportedBy === player.id,
        }
      : null,
  });
});

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/report$/, async (req, res, body, [id]) => {
  await withLock(id, async () => {
    const t = await loadTournament(id);
    if (!t) return send(res, 404, { error: 'No tournament with that code.' });

    const player = findPlayer(t, body.name, body.code);
    if (!player) return send(res, 403, { error: 'Name and code do not match.' });

    const { match } = currentMatchFor(t, player.id);
    if (!match) return send(res, 404, { error: 'You have no match in the current round.' });
    if (match.bye) return send(res, 400, { error: 'You have a bye this round — nothing to report.' });
    if (match.status === 'confirmed') {
      return send(res, 409, { error: 'This result is already confirmed. Speak to the organizer to change it.' });
    }

    const outcome = String(body.outcome || '');
    if (!['win', 'loss', 'draw'].includes(outcome)) {
      return send(res, 400, { error: 'Result must be win, loss or draw.' });
    }
    if (outcome === 'draw' && !t.settings.allowDraws) {
      return send(res, 400, { error: 'Draws are not permitted in this tournament.' });
    }

    const isP1 = match.p1 === player.id;
    match.result = outcome === 'draw' ? 'draw' : (outcome === 'win') === isP1 ? 'p1' : 'p2';
    match.status = 'pending';
    match.reportedBy = player.id;
    match.reportedAt = new Date().toISOString();

    await saveTournament(t);
    send(res, 200, { ok: true, status: match.status, result: match.result });
  });
});

// --- organizer-only from here ---------------------------------------------

async function adminAction(id, headers, res, fn) {
  return withLock(id, async () => {
    const t = await loadTournament(id);
    if (!t) return send(res, 404, { error: 'No tournament with that code.' });
    const token = (headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!checkAdmin(t, token)) return send(res, 401, { error: 'Organizer sign-in required.' });
    try {
      await fn(t);
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  });
}

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/players$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    const names = Array.isArray(body.names) ? body.names : [body.name];
    const added = [];
    const skipped = [];

    for (const raw of names) {
      const name = String(raw || '').trim().replace(/\s+/g, ' ');
      if (!name) continue;
      if (t.players.some((p) => normalise(p.name) === normalise(name))) {
        skipped.push(name);
        continue;
      }
      const used = new Set(t.players.map((p) => p.code));
      let code;
      do {
        code = makeCode(4);
      } while (used.has(code));

      const player = {
        id: `p${crypto.randomBytes(6).toString('hex')}`,
        name,
        code,
        seed: t.players.length + 1,
        dropped: false,
        arrivedLate: t.rounds.length > 0,
      };
      t.players.push(player);
      added.push({ name: player.name, code: player.code });
    }

    await saveTournament(t);
    send(res, 200, { added, skipped, total: t.players.length });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/players\/([a-z0-9]+)\/drop$/, (req, res, body, [id, pid], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    const player = t.players.find((p) => p.id === pid);
    if (!player) throw new Error('Player not found.');
    player.dropped = body.dropped !== false;
    await saveTournament(t);
    send(res, 200, { ok: true, dropped: player.dropped });
  })
);

route('DELETE', /^\/api\/tournaments\/([A-Z0-9]+)\/players\/([a-z0-9]+)$/, (req, res, body, [id, pid], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    if (t.rounds.length > 0) throw new Error('Cannot remove a player after round 1 has started. Drop them instead.');
    t.players = t.players.filter((p) => p.id !== pid);
    t.players.forEach((p, i) => {
      p.seed = i + 1;
    });
    await saveTournament(t);
    send(res, 200, { ok: true, total: t.players.length });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/settings$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    if (body.rounds !== undefined) {
      const r = Number(body.rounds);
      if (!Number.isInteger(r) || r < 1 || r > 20) throw new Error('Rounds must be 1 to 20.');
      if (r < t.rounds.length) throw new Error(`${t.rounds.length} rounds have already been played.`);
      t.settings.rounds = r;
    }
    if (body.topCut !== undefined) t.settings.topCut = Number(body.topCut) || 0;
    if (body.allowDraws !== undefined) t.settings.allowDraws = !!body.allowDraws;
    await saveTournament(t);
    send(res, 200, { ok: true, settings: t.settings });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/pair$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    const last = t.rounds[t.rounds.length - 1];
    if (last) {
      const open = last.matches.filter((m) => m.status !== 'confirmed');
      if (open.length > 0 && !body.force) {
        throw new Error(`${open.length} result(s) in round ${last.number} are not confirmed yet.`);
      }
    }
    if (t.rounds.length >= t.settings.rounds && !body.force) {
      throw new Error(`All ${t.settings.rounds} rounds are done. Raise the round count or start the top cut.`);
    }

    const round = swiss.pairNextRound(t);
    t.rounds.push(round);
    t.status = 'swiss';
    await saveTournament(t);
    send(res, 200, { ok: true, round: round.number, hadRematch: round.hadRematch });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/repair$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    const last = t.rounds[t.rounds.length - 1];
    if (!last) throw new Error('No round to re-pair.');
    if (last.matches.some((m) => m.status === 'confirmed' && !m.bye)) {
      throw new Error('Results have already been confirmed in this round.');
    }
    t.rounds.pop();
    const round = swiss.pairNextRound(t);
    t.rounds.push(round);
    await saveTournament(t);
    send(res, 200, { ok: true, round: round.number, hadRematch: round.hadRematch });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/result$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    const pool = t.cut && t.status === 'cut' ? t.cut.rounds : t.rounds;
    const round = pool[pool.length - 1];
    if (!round) throw new Error('No active round.');
    const match = round.matches.find((m) => m.id === body.matchId);
    if (!match) throw new Error('Match not found in the current round.');
    if (match.bye) throw new Error('A bye cannot be edited.');

    const result = String(body.result || '');
    if (!['p1', 'p2', 'draw'].includes(result)) throw new Error('Result must be p1, p2 or draw.');
    if (result === 'draw' && t.status === 'cut') throw new Error('A bracket match cannot be a draw.');
    if (result === 'draw' && !t.settings.allowDraws) throw new Error('Draws are not permitted.');

    match.result = result;
    match.status = 'confirmed';
    match.confirmedAt = new Date().toISOString();
    await saveTournament(t);
    send(res, 200, { ok: true });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/confirm-all$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    const pool = t.cut && t.status === 'cut' ? t.cut.rounds : t.rounds;
    const round = pool[pool.length - 1];
    if (!round) throw new Error('No active round.');
    let count = 0;
    for (const m of round.matches) {
      if (m.status === 'pending' && m.result) {
        m.status = 'confirmed';
        m.confirmedAt = new Date().toISOString();
        count++;
      }
    }
    await saveTournament(t);
    send(res, 200, { ok: true, confirmed: count });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/reopen$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    const pool = t.cut && t.status === 'cut' ? t.cut.rounds : t.rounds;
    const round = pool[pool.length - 1];
    if (!round) throw new Error('No active round.');
    const match = round.matches.find((m) => m.id === body.matchId);
    if (!match) throw new Error('Match not found.');
    if (match.bye) throw new Error('A bye cannot be reopened.');
    match.status = 'open';
    match.result = null;
    match.reportedBy = null;
    match.confirmedAt = null;
    await saveTournament(t);
    send(res, 200, { ok: true });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/cut$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    const size = Number(body.size) || t.settings.topCut;
    if (![2, 4, 8, 16, 32].includes(size)) throw new Error('Top cut must be 2, 4, 8, 16 or 32.');
    const last = t.rounds[t.rounds.length - 1];
    if (last && last.matches.some((m) => m.status !== 'confirmed')) {
      throw new Error('Confirm every Swiss result before cutting.');
    }
    t.cut = swiss.buildCut(t, size);
    t.settings.topCut = size;
    t.status = 'cut';
    await saveTournament(t);
    send(res, 200, { ok: true, size });
  })
);

route('POST', /^\/api\/tournaments\/([A-Z0-9]+)\/cut\/advance$/, (req, res, body, [id], q, headers) =>
  adminAction(id, headers, res, async (t) => {
    if (!t.cut) throw new Error('No top cut has been started.');
    const round = swiss.advanceCut(t.cut);
    if (!round) {
      t.status = 'done';
      await saveTournament(t);
      return send(res, 200, { ok: true, finished: true });
    }
    await saveTournament(t);
    send(res, 200, { ok: true, round: round.number });
  })
);

route('GET', /^\/api\/tournaments\/([A-Z0-9]+)\/export$/, async (req, res, body, [id], query, headers) => {
  const t = await loadTournament(id);
  if (!t) return send(res, 404, { error: 'No tournament with that code.' });
  const token = (headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!checkAdmin(t, token)) return send(res, 401, { error: 'Organizer sign-in required.' });

  const copy = { ...t };
  delete copy.passwordHash;
  delete copy.passwordSalt;
  delete copy.adminToken;

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${t.id}-${t.name.replace(/[^\w-]+/g, '_')}.json"`,
  });
  res.end(JSON.stringify(copy, null, 2));
});

// ----------------------------------------------------------------- static ---

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/organizer') rel = '/organizer.html';
  if (rel === '/standings') rel = '/standings.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });

  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const match = r.pattern.exec(pathname);
        if (!match) continue;
        return await r.handler(req, res, body, match.slice(1), url.searchParams, req.headers);
      }
      return send(res, 404, { error: 'Unknown endpoint' });
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${pathname}`, err);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Onic tournament server listening on http://0.0.0.0:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
