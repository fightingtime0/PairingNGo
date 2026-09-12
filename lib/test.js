'use strict';

const swiss = require('./swiss');
const assert = require('assert');

function makeTournament(n) {
  return {
    players: Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Player ${i + 1}`,
      seed: i + 1,
      dropped: false,
      arrivedLate: false,
    })),
    rounds: [],
  };
}

// Deterministic RNG so failures are reproducible.
function makeRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// --- 1. Win percentage matches the published 3-1-1 = 70% example -----------
{
  const rec = { wins: 3, losses: 1, draws: 1, roundsPlayed: 5 };
  const pct = swiss.winPct(rec);
  assert.ok(Math.abs(pct - 0.7) < 1e-9, `expected 70%, got ${pct}`);
  console.log('win% 3-1-1 ->', (pct * 100).toFixed(2) + '%');
}

// --- 2. Floor and cap ------------------------------------------------------
{
  assert.strictEqual(swiss.winPct({ wins: 1, losses: 4, draws: 0, roundsPlayed: 5 }), 0.25);
  // A player who finished the event caps at 100%...
  assert.strictEqual(swiss.winPct({ wins: 5, losses: 0, draws: 0, roundsPlayed: 5 }), 1);
  // ...one who dropped caps at 75%.
  assert.strictEqual(
    swiss.winPct({ wins: 5, losses: 0, draws: 0, roundsPlayed: 5, dropped: true }),
    0.75
  );
  assert.ok(Math.abs(swiss.winPct({ wins: 3, losses: 2, draws: 0, roundsPlayed: 5 }) - 0.6) < 1e-9);
  console.log('floor 25% / cap 100% finished, 75% dropped / 3-2 = 60% all correct');
}

// --- 3. Full tournament simulation across many sizes -----------------------
function simulate(n, seed, drawRate) {
  const t = makeTournament(n);
  const rng = makeRng(seed);
  const rounds = swiss.suggestRounds(n);

  for (let r = 0; r < rounds; r++) {
    const round = swiss.pairNextRound(t, rng);
    t.rounds.push(round);
    for (const m of round.matches) {
      if (m.bye) continue;
      const roll = rng();
      m.result = roll < drawRate ? 'draw' : roll < 0.5 + drawRate / 2 ? 'p1' : 'p2';
      m.status = 'confirmed';
    }
  }
  return t;
}

let rematchCount = 0;
const sizes = [4, 5, 6, 7, 8, 9, 12, 15, 16, 23, 32, 33, 64, 65, 100, 128, 129, 200];

for (const n of sizes) {
  for (let seed = 1; seed <= 5; seed++) {
    const t = simulate(n, seed, 0.08);
    const standings = swiss.computeStandings(t);

    assert.strictEqual(standings.length, n, `standings size mismatch at n=${n}`);

    // Nobody sits idle: every active player appears exactly once per round.
    for (const round of t.rounds) {
      const seen = new Set();
      for (const m of round.matches) {
        assert.ok(!seen.has(m.p1), `duplicate player in round ${round.number}, n=${n}`);
        seen.add(m.p1);
        if (!m.bye) {
          assert.ok(!seen.has(m.p2), `duplicate player in round ${round.number}, n=${n}`);
          seen.add(m.p2);
        }
      }
      assert.strictEqual(seen.size, n, `not everyone paired at n=${n} round ${round.number}`);
      const byes = round.matches.filter((m) => m.bye).length;
      assert.ok(byes === (n % 2 === 1 ? 1 : 0), `bad bye count at n=${n}`);
      if (round.hadRematch) rematchCount++;
    }

    // Nobody receives two byes while someone else has none.
    const recs = swiss.buildRecords(t);
    const byeCounts = [...recs.values()].map((r) => r.byes);
    if (n % 2 === 1) {
      assert.ok(Math.max(...byeCounts) - Math.min(...byeCounts) <= 1, `uneven byes at n=${n}`);
    }

    // Points must equal 3*W + 1*D + 3*byes.
    for (const row of standings) {
      const rec = recs.get(row.id);
      assert.strictEqual(row.points, rec.wins * 3 + rec.draws + rec.byes * 3, 'points mismatch');
    }

    // Standings must be monotonically non-increasing on points.
    for (let i = 1; i < standings.length; i++) {
      assert.ok(standings[i - 1].points >= standings[i].points, 'standings out of order');
    }

    // Every tiebreaker value stays inside the legal band.
    for (const row of standings) {
      assert.ok(row.opWinPct >= 0.25 - 1e-9 && row.opWinPct <= 1 + 1e-9, 'OWP out of band');
      assert.ok(row.opOpWinPct >= 0.25 - 1e-9 && row.opOpWinPct <= 1 + 1e-9, 'OOWP out of band');
    }
  }
}
console.log(`simulated ${sizes.length * 5} tournaments, sizes ${sizes[0]}-${sizes[sizes.length - 1]}`);
console.log(`rounds needing a rematch: ${rematchCount} (0 is ideal, low is acceptable)`);

// --- 4. Byes are excluded from opponent win % ------------------------------
{
  const t = makeTournament(3);
  t.rounds.push({
    number: 1,
    matches: [
      { id: 'a', table: 1, p1: 'p1', p2: 'p2', bye: false, result: 'p1', status: 'confirmed' },
      { id: 'b', table: null, p1: 'p3', p2: null, bye: true, result: 'p1', status: 'confirmed' },
    ],
  });
  const recs = swiss.buildRecords(t);
  assert.strictEqual(recs.get('p3').points, 3, 'bye should award 3 points');
  assert.strictEqual(recs.get('p3').wins, 0, 'bye must not count as a win');
  assert.strictEqual(recs.get('p3').roundsPlayed, 0, 'bye round must not count as played');
  console.log('bye handling correct: 3 points, not counted as a win, excluded from win%');
}

// --- 5. Unconfirmed results do not move standings --------------------------
{
  const t = makeTournament(2);
  t.rounds.push({
    number: 1,
    matches: [
      { id: 'a', table: 1, p1: 'p1', p2: 'p2', bye: false, result: 'p1', status: 'pending' },
    ],
  });
  const standings = swiss.computeStandings(t);
  assert.strictEqual(standings[0].points, 0, 'pending result must not score');
  console.log('pending results correctly excluded from standings');
}

// --- 6. Top cut seeding ----------------------------------------------------
{
  assert.deepStrictEqual(swiss.seedBracket(4), [1, 4, 2, 3]);
  assert.deepStrictEqual(swiss.seedBracket(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  console.log('bracket seeding: top seed meets bottom seed, halves stay apart');

  const t = simulate(32, 7, 0.05);
  const cut = swiss.buildCut(t, 8);
  assert.strictEqual(cut.rounds[0].matches.length, 4);
  for (const m of cut.rounds[0].matches) {
    m.result = 'p1';
    m.status = 'confirmed';
  }
  swiss.advanceCut(cut);
  assert.strictEqual(cut.rounds[1].matches.length, 2);
  for (const m of cut.rounds[1].matches) {
    m.result = 'p1';
    m.status = 'confirmed';
  }
  swiss.advanceCut(cut);
  assert.strictEqual(cut.rounds[2].matches.length, 1);
  console.log('top 8 bracket advances 4 -> 2 -> 1 correctly');
}

// --- 7. turni.id compatibility mode --------------------------------------
{
  // In a bye-free, drop-free event of R rounds, every player faces R opponents
  // who each played R rounds. If Op Win % is match points over available match
  // points, then WOScore must equal OpWin% * 3 * R * R. On the real 5-round,
  // 32-player standings this is the observed WOScore = OMW * 75.
  const rounds = 5;
  const t = makeTournament(32);
  const rng = makeRng(99);
  for (let r = 0; r < rounds; r++) {
    const round = swiss.pairNextRound(t, rng);
    t.rounds.push(round);
    for (const m of round.matches) {
      const roll = rng();
      m.result = roll < 0.12 ? 'draw' : roll < 0.56 ? 'p1' : 'p2';
      m.status = 'confirmed';
    }
  }

  const turni = swiss.computeStandings(t, 'turni');
  const factor = 3 * rounds * rounds; // 75
  for (const row of turni) {
    const expected = row.opWinPct * factor;
    assert.ok(
      Math.abs(expected - row.woScore) < 1e-6,
      `WOScore mismatch: OMW ${row.opWinPct} * ${factor} = ${expected}, got ${row.woScore}`
    );
  }
  console.log(`turni mode: WOScore = Op Win % x ${factor} holds for all 32 players`);

  // The official mode must floor at 25%; turni mode must be allowed below it.
  const official = swiss.computeStandings(t, 'official');
  assert.ok(official.every((r) => r.opWinPct >= 0.25 - 1e-9), 'official mode must floor at 25%');
  const lowest = Math.min(...turni.map((r) => r.opWinPct));
  console.log(`official mode floors at 25%; turni mode reaches ${(lowest * 100).toFixed(1)}%`);

  // The two modes should generally agree near the top but need not agree everywhere.
  const differences = turni.filter((r, i) => official[i].id !== r.id).length;
  console.log(`the two modes rank ${differences} of 32 players differently on this data`);
}

console.log('\nAll checks passed.');
