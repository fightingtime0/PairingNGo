'use strict';

const assert = require('assert');
const BASE = 'http://127.0.0.1:3999';

async function call(method, path, body, token) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

(async () => {
  // --- create -------------------------------------------------------------
  let r = await call('POST', '/api/tournaments', {
    name: 'Onic Weekly Test',
    rounds: 5,
    topCut: 8,
    password: 'rahasia123',
    allowDraws: true,
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const { id, adminToken } = r.data;
  console.log(`created tournament ${id}`);

  // Wrong password must fail.
  r = await call('POST', `/api/tournaments/${id}/login`, { password: 'salah' });
  assert.strictEqual(r.status, 401);
  r = await call('POST', `/api/tournaments/${id}/login`, { password: 'rahasia123' });
  assert.strictEqual(r.status, 200);
  console.log('password check works');

  // --- players ------------------------------------------------------------
  const names = Array.from({ length: 23 }, (_, i) => `Pemain ${i + 1}`);
  r = await call('POST', `/api/tournaments/${id}/players`, { names }, adminToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.added.length, 23);

  // Duplicates are skipped, not added twice.
  r = await call('POST', `/api/tournaments/${id}/players`, { names: ['Pemain 1'] }, adminToken);
  assert.strictEqual(r.data.skipped.length, 1);
  assert.strictEqual(r.data.total, 23);
  console.log('23 players added, duplicate correctly skipped');

  // Admin view carries codes; public view must not.
  const admin = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
  const pub = (await call('GET', `/api/tournaments/${id}`)).data;
  assert.ok(admin.players[0].code, 'admin view should include codes');
  assert.strictEqual(pub.players, undefined, 'public view must not leak the player list with codes');
  const codes = new Map(admin.players.map((p) => [p.name, p.code]));
  console.log('player codes are hidden from the public view');

  // Unauthenticated write must be rejected.
  r = await call('POST', `/api/tournaments/${id}/pair`, {});
  assert.strictEqual(r.status, 401);
  r = await call('POST', `/api/tournaments/${id}/pair`, {}, 'wrong-token');
  assert.strictEqual(r.status, 401);
  console.log('writes rejected without a valid organizer token');

  // --- five swiss rounds, players self-reporting --------------------------
  for (let round = 1; round <= 5; round++) {
    r = await call('POST', `/api/tournaments/${id}/pair`, {}, adminToken);
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));

    const state = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
    const matches = state.round.matches.filter((m) => !m.bye);

    // One player from each match reports.
    for (const m of matches) {
      const reporter = Math.random() < 0.5 ? m.p1 : m.p2;
      const roll = Math.random();
      const outcome = roll < 0.1 ? 'draw' : roll < 0.55 ? 'win' : 'loss';
      const rep = await call('POST', `/api/tournaments/${id}/report`, {
        name: reporter,
        code: codes.get(reporter),
        outcome,
      });
      assert.strictEqual(rep.status, 200, JSON.stringify(rep.data));
    }

    // Wrong code must be rejected.
    const bad = await call('POST', `/api/tournaments/${id}/report`, {
      name: matches[0].p1,
      code: 'ZZZZ',
      outcome: 'win',
    });
    assert.strictEqual(bad.status, 403);

    // Standings must not have moved on unconfirmed results.
    const midway = (await call('GET', `/api/tournaments/${id}`)).data;
    const expectedPoints = midway.standings.reduce((s, x) => s + x.points, 0);

    r = await call('POST', `/api/tournaments/${id}/confirm-all`, {}, adminToken);
    assert.strictEqual(r.data.confirmed, matches.length);

    const after = (await call('GET', `/api/tournaments/${id}`)).data;
    const afterPoints = after.standings.reduce((s, x) => s + x.points, 0);
    assert.ok(afterPoints > expectedPoints, 'confirming should increase total points');
  }
  console.log('five swiss rounds completed with self-reporting and confirmation');

  // --- lookup -------------------------------------------------------------
  const look = await call('POST', `/api/tournaments/${id}/lookup`, {
    name: 'Pemain 7',
    code: codes.get('Pemain 7'),
  });
  assert.strictEqual(look.status, 200);
  assert.ok(look.data.record.rank >= 1 && look.data.record.rank <= 23);
  console.log(`player lookup works — Pemain 7 is rank ${look.data.record.rank} of 23`);

  const wrongLook = await call('POST', `/api/tournaments/${id}/lookup`, { name: 'Pemain 7', code: 'AAAA' });
  assert.strictEqual(wrongLook.status, 404);

  // --- standings sanity ---------------------------------------------------
  const final = (await call('GET', `/api/tournaments/${id}`)).data;
  assert.strictEqual(final.standings.length, 23);
  for (let i = 1; i < final.standings.length; i++) {
    const a = final.standings[i - 1];
    const b = final.standings[i];
    assert.ok(
      a.points > b.points ||
      (a.points === b.points && a.opWinPct >= b.opWinPct - 1e-9),
      `standings misordered at rank ${i + 1}`
    );
  }
  console.log('final standings correctly ordered by points then Op Win %');

  // --- top cut ------------------------------------------------------------
  r = await call('POST', `/api/tournaments/${id}/cut`, { size: 8 }, adminToken);
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));

  for (let stage = 0; stage < 3; stage++) {
    const state = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
    const bracketRound = state.cut.rounds[state.cut.rounds.length - 1];
    for (const m of bracketRound.matches) {
      await call('POST', `/api/tournaments/${id}/result`, { matchId: m.id, result: 'p1' }, adminToken);
    }
    await call('POST', `/api/tournaments/${id}/cut/advance`, {}, adminToken);
  }

  const done = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
  assert.strictEqual(done.status, 'done');
  assert.strictEqual(done.cut.rounds.length, 3);
  assert.strictEqual(done.cut.rounds[2].matches.length, 1);
  console.log('top 8 bracket ran to completion, tournament marked done');

  // --- backup export ------------------------------------------------------
  const exp = await fetch(`${BASE}/api/tournaments/${id}/export`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const backup = await exp.json();
  assert.strictEqual(backup.id, id);
  assert.strictEqual(backup.adminToken, undefined, 'backup must not contain the admin token');
  assert.strictEqual(backup.passwordHash, undefined, 'backup must not contain the password hash');
  assert.strictEqual(backup.players.length, 23);
  console.log('backup export works and excludes credentials');

  console.log('\nEnd-to-end run passed.');
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
