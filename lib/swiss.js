'use strict';

/*
 * Swiss engine.
 *
 * Match points: win 3, draw 1, loss 0.
 * Tiebreak order: points -> Opponents' Win % -> Opponents' Opponents' Win %
 *                 -> head-to-head -> late arrival -> random (stable by seed).
 *
 * Opponent win % = (wins + 0.5 * draws) / rounds played, floored at 0.25 and
 * capped at 1.00 for a player who completed the event, 0.75 for one who
 * dropped. Rounds where a player received a bye are excluded entirely, from
 * both the numerator and the denominator.
 *
 * NOTE: the handbook makes tardiness the FIRST tiebreaker, ahead of Op Win %.
 * This engine applies it late, after head-to-head. The ordering moved between
 * handbook revisions — confirm which revision is in play before changing it.
 */

const WIN_POINTS = 3;
const DRAW_POINTS = 1;
const LOSS_POINTS = 0;
const WIN_PCT_FLOOR = 0.25;
// The handbook sets two different ceilings: a player who completed the event
// caps at 100%, a player who dropped before the end caps at 75%. Using 75% for
// everybody under-credits the opponents of anyone who went undefeated, which is
// precisely the top of the standings where the cut is decided.
const WIN_PCT_CAP_COMPLETED = 1;
const WIN_PCT_CAP_DROPPED = 0.75;

// ---------------------------------------------------------------- records ---

/**
 * Walk every confirmed match and build a per-player record.
 * Unconfirmed results are deliberately ignored so standings never move on a
 * result the organizer has not signed off.
 */
function buildRecords(tournament) {
  const records = new Map();

  for (const p of tournament.players) {
    records.set(p.id, {
      id: p.id,
      name: p.name,
      ptcgId: p.ptcgId || null,
      dropped: !!p.dropped,
      arrivedLate: !!p.arrivedLate,
      seed: p.seed,
      wins: 0,
      losses: 0,
      draws: 0,
      byes: 0,
      points: 0,
      playPoints: 0, // points from actual matches, byes excluded
      opponents: [], // opponent ids, byes excluded
      played: new Set(), // for rematch avoidance, byes excluded
      roundsPlayed: 0, // byes excluded
    });
  }

  for (const round of tournament.rounds) {
    for (const match of round.matches) {
      if (match.bye) {
        const r = records.get(match.p1);
        if (r) {
          r.byes += 1;
          r.points += WIN_POINTS;
        }
        continue;
      }
      if (match.status !== 'confirmed' || !match.result) continue;

      const a = records.get(match.p1);
      const b = records.get(match.p2);
      if (!a || !b) continue;

      a.opponents.push(b.id);
      b.opponents.push(a.id);
      a.played.add(b.id);
      b.played.add(a.id);
      a.roundsPlayed += 1;
      b.roundsPlayed += 1;

      if (match.result === 'draw') {
        a.draws += 1;
        b.draws += 1;
        a.points += DRAW_POINTS;
        b.points += DRAW_POINTS;
        a.playPoints += DRAW_POINTS;
        b.playPoints += DRAW_POINTS;
      } else if (match.result === 'p1') {
        a.wins += 1;
        b.losses += 1;
        a.points += WIN_POINTS;
        b.points += LOSS_POINTS;
        a.playPoints += WIN_POINTS;
        b.playPoints += LOSS_POINTS;
      } else if (match.result === 'p2') {
        b.wins += 1;
        a.losses += 1;
        b.points += WIN_POINTS;
        a.points += LOSS_POINTS;
        b.playPoints += WIN_POINTS;
        a.playPoints += LOSS_POINTS;
      }
    }
  }

  // Pairings that exist but are not yet confirmed still count as "already
  // played" so a re-pair of the same round cannot produce a rematch.
  for (const round of tournament.rounds) {
    for (const match of round.matches) {
      if (match.bye || match.status === 'confirmed') continue;
      const a = records.get(match.p1);
      const b = records.get(match.p2);
      if (a && b) {
        a.played.add(b.id);
        b.played.add(a.id);
      }
    }
  }

  return records;
}

/**
 * A single player's own win percentage. Byes are already excluded.
 *
 * mode 'official' follows the Play! Pokémon handbook: wins plus half draws over
 * rounds played, floored at 25%, capped at 100% for a player who completed the
 * event and at 75% for one who dropped.
 *
 * mode 'turni' reproduces what turni.id appears to do, inferred from its
 * published standings rather than from documentation: match points over the
 * maximum available match points, with no floor and no cap. A draw is therefore
 * worth a third of a win rather than half, and figures below 25% are possible.
 */
function winPct(record, mode) {
  if (!record || record.roundsPlayed === 0) {
    return mode === 'turni' ? 0 : WIN_PCT_FLOOR;
  }
  if (mode === 'turni') {
    return record.playPoints / (WIN_POINTS * record.roundsPlayed);
  }
  const raw = (record.wins + 0.5 * record.draws) / record.roundsPlayed;
  const cap = record.dropped ? WIN_PCT_CAP_DROPPED : WIN_PCT_CAP_COMPLETED;
  return Math.min(cap, Math.max(WIN_PCT_FLOOR, raw));
}

function averageOf(values, mode) {
  if (values.length === 0) return mode === 'turni' ? 0 : WIN_PCT_FLOOR;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// -------------------------------------------------------------- standings ---

function computeStandings(tournament, modeOverride) {
  const mode = modeOverride || (tournament.settings && tournament.settings.tiebreakers) || 'official';
  const records = buildRecords(tournament);

  const ownPct = new Map();
  for (const [id, rec] of records) ownPct.set(id, winPct(rec, mode));

  const opWinPct = new Map();
  for (const [id, rec] of records) {
    opWinPct.set(id, averageOf(rec.opponents.map((oid) => ownPct.get(oid) ?? 0), mode));
  }

  const opOpWinPct = new Map();
  for (const [id, rec] of records) {
    opOpWinPct.set(id, averageOf(rec.opponents.map((oid) => opWinPct.get(oid) ?? 0), mode));
  }

  // WOScore: the raw total of your opponents' match points. Splits ties where
  // the percentages round to the same value.
  const woScore = new Map();
  for (const [id, rec] of records) {
    woScore.set(id, rec.opponents.reduce((sum, oid) => sum + (records.get(oid)?.points || 0), 0));
  }

  const rows = [...records.values()].map((rec) => ({
    id: rec.id,
    name: rec.name,
    ptcgId: rec.ptcgId,
    dropped: rec.dropped,
    arrivedLate: rec.arrivedLate,
    seed: rec.seed,
    wins: rec.wins,
    losses: rec.losses,
    draws: rec.draws,
    byes: rec.byes,
    points: rec.points,
    opWinPct: opWinPct.get(rec.id),
    opOpWinPct: opOpWinPct.get(rec.id),
    woScore: woScore.get(rec.id),
    opponents: rec.opponents,
  }));

  const beat = headToHeadTable(tournament);

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (Math.abs(b.opWinPct - a.opWinPct) > 1e-9) return b.opWinPct - a.opWinPct;
    if (Math.abs(b.opOpWinPct - a.opOpWinPct) > 1e-9) return b.opOpWinPct - a.opOpWinPct;

    const h2h = beat.get(`${a.id}:${b.id}`);
    if (h2h === 'a') return -1;
    if (h2h === 'b') return 1;

    if (mode === 'turni') {
      if (b.woScore !== a.woScore) return b.woScore - a.woScore;
    } else if (a.arrivedLate !== b.arrivedLate) {
      return a.arrivedLate ? 1 : -1;
    }
    return a.seed - b.seed; // stable, deterministic stand-in for the random draw
  });

  rows.forEach((row, i) => {
    row.rank = i + 1;
  });
  return rows;
}

/** Map of "winnerId:loserId" -> which side won, for head-to-head resolution. */
function headToHeadTable(tournament) {
  const table = new Map();
  for (const round of tournament.rounds) {
    for (const match of round.matches) {
      if (match.bye || match.status !== 'confirmed' || !match.result) continue;
      if (match.result === 'draw') continue;
      const winner = match.result === 'p1' ? match.p1 : match.p2;
      const loser = match.result === 'p1' ? match.p2 : match.p1;
      table.set(`${winner}:${loser}`, 'a');
      table.set(`${loser}:${winner}`, 'b');
    }
  }
  return table;
}

// ---------------------------------------------------------------- pairing ---

/**
 * Backtracking pair search over players sorted by standing.
 * Tries to pair each player with the nearest-ranked legal opponent, backing out
 * when a branch leaves someone unpairable. Falls back to allowing rematches
 * only if no rematch-free pairing exists at all.
 */
function findPairs(players, played, allowRematch) {
  if (players.length === 0) return [];
  const [first, ...rest] = players;

  for (let i = 0; i < rest.length; i++) {
    const candidate = rest[i];
    const isRematch = played.get(first.id)?.has(candidate.id);
    if (isRematch && !allowRematch) continue;

    const remaining = rest.slice(0, i).concat(rest.slice(i + 1));
    const sub = findPairs(remaining, played, allowRematch);
    if (sub !== null) return [[first, candidate], ...sub];
  }
  return null;
}

function pairNextRound(tournament, rng) {
  const records = buildRecords(tournament);
  const roundNumber = tournament.rounds.length + 1;

  const active = tournament.players.filter((p) => !p.dropped);
  if (active.length < 2) {
    throw new Error('Need at least two active players to pair a round.');
  }

  let ordered;
  if (roundNumber === 1) {
    ordered = shuffle(active.slice(), rng).map((p) => ({ id: p.id, name: p.name }));
  } else {
    const standings = computeStandings(tournament);
    const activeIds = new Set(active.map((p) => p.id));
    ordered = standings
      .filter((row) => activeIds.has(row.id))
      .map((row) => ({ id: row.id, name: row.name }));
  }

  const matches = [];
  let byePlayer = null;

  if (ordered.length % 2 === 1) {
    // Bye goes to the lowest-ranked player who has not already had one.
    for (let i = ordered.length - 1; i >= 0; i--) {
      const rec = records.get(ordered[i].id);
      if (!rec || rec.byes === 0) {
        byePlayer = ordered.splice(i, 1)[0];
        break;
      }
    }
    if (!byePlayer) byePlayer = ordered.pop();
  }

  const played = new Map();
  for (const [id, rec] of records) played.set(id, rec.played);

  let pairs = findPairs(ordered, played, false);
  let hadRematch = false;
  if (pairs === null) {
    pairs = findPairs(ordered, played, true);
    hadRematch = true;
  }
  if (pairs === null) throw new Error('Could not build a valid pairing.');

  let table = 1;
  for (const [a, b] of pairs) {
    matches.push({
      id: `r${roundNumber}m${table}`,
      table: table++,
      p1: a.id,
      p2: b.id,
      bye: false,
      result: null,
      status: 'open', // open -> pending -> confirmed
      reportedBy: null,
      reportedAt: null,
      confirmedAt: null,
    });
  }

  if (byePlayer) {
    matches.push({
      id: `r${roundNumber}bye`,
      table: null,
      p1: byePlayer.id,
      p2: null,
      bye: true,
      result: 'p1',
      status: 'confirmed',
      reportedBy: null,
      reportedAt: null,
      confirmedAt: new Date().toISOString(),
    });
  }

  return {
    number: roundNumber,
    matches,
    hadRematch,
    startedAt: new Date().toISOString(),
  };
}

function shuffle(array, rng) {
  const rand = rng || Math.random;
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// --------------------------------------------------------------- top cut ---

/** Seeds 1 v N, 2 v N-1, ... for a single-elimination bracket. */
function seedBracket(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const round = [];
    const total = seeds.length * 2 + 1;
    for (const s of seeds) {
      round.push(s, total - s);
    }
    seeds = round;
  }
  return seeds;
}

function buildCut(tournament, size) {
  const standings = computeStandings(tournament).filter((r) => !r.dropped);
  if (standings.length < size) {
    throw new Error(`Only ${standings.length} active players — cannot cut to top ${size}.`);
  }

  const qualified = standings.slice(0, size);
  const order = seedBracket(size);
  const matches = [];

  for (let i = 0; i < order.length; i += 2) {
    const a = qualified[order[i] - 1];
    const b = qualified[order[i + 1] - 1];
    matches.push({
      id: `cut1m${i / 2 + 1}`,
      table: i / 2 + 1,
      p1: a.id,
      p2: b.id,
      bye: false,
      result: null,
      status: 'open',
      reportedBy: null,
      reportedAt: null,
      confirmedAt: null,
      seeds: [order[i], order[i + 1]],
    });
  }

  return {
    size,
    seeding: qualified.map((r, i) => ({ seed: i + 1, id: r.id, name: r.name })),
    rounds: [{ number: 1, matches, startedAt: new Date().toISOString() }],
  };
}

function advanceCut(cut) {
  const last = cut.rounds[cut.rounds.length - 1];
  const unfinished = last.matches.filter((m) => m.status !== 'confirmed');
  if (unfinished.length > 0) {
    throw new Error('All matches in the current bracket round must be confirmed first.');
  }
  if (last.matches.length === 1) return null; // final already played

  const winners = last.matches.map((m) => (m.result === 'p1' ? m.p1 : m.p2));
  const roundNumber = last.number + 1;
  const matches = [];
  for (let i = 0; i < winners.length; i += 2) {
    matches.push({
      id: `cut${roundNumber}m${i / 2 + 1}`,
      table: i / 2 + 1,
      p1: winners[i],
      p2: winners[i + 1],
      bye: false,
      result: null,
      status: 'open',
      reportedBy: null,
      reportedAt: null,
      confirmedAt: null,
    });
  }
  const round = { number: roundNumber, matches, startedAt: new Date().toISOString() };
  cut.rounds.push(round);
  return round;
}

/** Suggested Swiss round count. Organizer can always override. */
function suggestRounds(playerCount) {
  if (playerCount <= 2) return 1;
  return Math.max(1, Math.ceil(Math.log2(playerCount)));
}

function suggestCut(playerCount) {
  if (playerCount < 8) return 0;
  if (playerCount < 16) return 4;
  if (playerCount < 64) return 8;
  return 8;
}

module.exports = {
  buildRecords,
  computeStandings,
  pairNextRound,
  buildCut,
  advanceCut,
  seedBracket,
  suggestRounds,
  suggestCut,
  winPct,
  WIN_PCT_FLOOR,
  WIN_PCT_CAP_COMPLETED,
  WIN_PCT_CAP_DROPPED,
  WIN_POINTS,
  DRAW_POINTS,
  LOSS_POINTS,
};
