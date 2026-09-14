'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
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
    tiebreakers: 'turni',
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
  const names = Array.from({ length: 23 }, (_, i) => `Pemain ${i + 1}, id${String(10000000 + i)}`);
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
  const idOf = new Map(admin.players.map((p) => [p.name, p.id]));
  const codeOf = new Map(admin.players.map((p) => [p.name, p.code]));
  assert.ok(admin.players[0].ptcgId, 'PTCG ID should be stored');
  console.log(`player codes hidden from public view; PTCG IDs stored (${admin.players[0].ptcgId})`);

  // PTCG IDs are real-world identifiers: the organizer sees them, nobody else.
  assert.ok(
    pub.standings.every((row) => row.ptcgId === undefined),
    'public standings must not carry PTCG IDs'
  );
  assert.ok(
    admin.standings.some((row) => row.ptcgId),
    'organizer standings should carry PTCG IDs'
  );

  // Public name search must work without any credential.
  const search = await call('GET', `/api/tournaments/${id}/search?q=pemain%201`);
  assert.strictEqual(search.status, 200);
  assert.ok(search.data.players.length >= 1, 'name search should find players');
  const byPtcg = await call('GET', `/api/tournaments/${id}/search?q=id10000005`);
  assert.strictEqual(byPtcg.data.players.length, 1, 'PTCG ID search should find exactly one');
  assert.ok(
    byPtcg.data.players.every((pl) => pl.ptcgId === undefined),
    'search may match on PTCG ID but must never return one'
  );
  console.log('public search works by name and by PTCG ID, and returns neither');

  // A PTCG ID must not fall out of the public CSV either.
  const pubCsv = await fetch(`${BASE}/api/tournaments/${id}/standings.csv`);
  const pubCsvText = await pubCsv.text();
  assert.ok(!pubCsvText.includes('PTCG ID'), 'public CSV must not have a PTCG ID column');
  assert.ok(!pubCsvText.includes('id10000005'), 'public CSV must not contain a PTCG ID');
  console.log('public CSV omits the PTCG ID column');

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

    // One player from each match reports, with their own name and code.
    for (const m of matches) {
      const reporter = Math.random() < 0.5 ? m.p1 : m.p2;
      const roll = Math.random();
      const outcome = roll < 0.1 ? 'draw' : roll < 0.55 ? 'win' : 'loss';
      const rep = await call('POST', `/api/tournaments/${id}/report`, {
        name: reporter,
        code: codeOf.get(reporter),
        outcome,
      });
      assert.strictEqual(rep.status, 200, JSON.stringify(rep.data));
    }

    // An unknown player must be rejected.
    const bad = await call('POST', `/api/tournaments/${id}/report`, {
      name: 'Nobody At All',
      code: 'ZZZZ',
      outcome: 'win',
    });
    assert.strictEqual(bad.status, 403);

    // A real player with the wrong code must be rejected — this is the check
    // that stops anyone who knows a name from filing a result as that player.
    const wrongCode = await call('POST', `/api/tournaments/${id}/report`, {
      name: matches[0].p1,
      code: codeOf.get(matches[0].p1) === 'AAAA' ? 'BBBB' : 'AAAA',
      outcome: 'win',
    });
    assert.strictEqual(wrongCode.status, 403, 'a wrong player code must be refused');

    // And the internal player id must not work as a credential on its own.
    const idOnly = await call('POST', `/api/tournaments/${id}/report`, {
      playerId: idOf.get(matches[0].p1),
      outcome: 'win',
    });
    assert.strictEqual(idOnly.status, 403, 'a bare player id must not authorise a report');

    // Standings must not have moved on unconfirmed results.
    const midway = (await call('GET', `/api/tournaments/${id}`)).data;
    const expectedPoints = midway.standings.reduce((s, x) => s + x.points, 0);

    r = await call('POST', `/api/tournaments/${id}/confirm-all`, {}, adminToken);
    assert.strictEqual(r.data.confirmed, matches.length);

    const after = (await call('GET', `/api/tournaments/${id}`)).data;
    const afterPoints = after.standings.reduce((s, x) => s + x.points, 0);
    assert.ok(afterPoints > expectedPoints, 'confirming should increase total points');

    // THE GATE. Every match is confirmed, but the round is not signed off, so
    // nothing may be drawn from it yet.
    const early = await call('POST', `/api/tournaments/${id}/pair`, {}, adminToken);
    assert.strictEqual(early.status, 400, 'pairing must be refused before the round is confirmed');
    assert.ok(/Confirm round/i.test(early.data.error), early.data.error);

    const locked = await call('POST', `/api/tournaments/${id}/rounds/lock`, {}, adminToken);
    assert.strictEqual(locked.status, 200, JSON.stringify(locked.data));
    assert.strictEqual(locked.data.locked, true);

    // Locking twice is refused rather than silently repeated.
    const twice = await call('POST', `/api/tournaments/${id}/rounds/lock`, {}, adminToken);
    assert.strictEqual(twice.status, 400);
  }
  console.log('five swiss rounds completed with self-reporting and confirmation');
  console.log('round gate held on every round: no pairing until the round was confirmed');

  // --- the gate reopens cleanly ------------------------------------------
  {
    const state = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
    assert.strictEqual(state.round.locked, true, 'round 5 should be confirmed by now');

    // A confirmed round refuses edits until it is reopened.
    const target = state.round.matches.find((m) => !m.bye);
    const blocked = await call('POST', `/api/tournaments/${id}/result`,
      { matchId: target.id, result: 'p1' }, adminToken);
    assert.strictEqual(blocked.status, 400, 'a locked round must refuse a result change');

    // Reopening one match reopens the round it sits in — the organizer's
    // sign-off no longer describes what is in the round.
    const reopened = await call('POST', `/api/tournaments/${id}/reopen`,
      { matchId: target.id }, adminToken);
    assert.strictEqual(reopened.status, 200);
    const afterReopen = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
    assert.strictEqual(afterReopen.round.locked, false, 'reopening a match must unlock the round');

    // Put it back the way it was and re-confirm.
    await call('POST', `/api/tournaments/${id}/result`,
      { matchId: target.id, result: target.result || 'p1' }, adminToken);
    const relock = await call('POST', `/api/tournaments/${id}/rounds/lock`, {}, adminToken);
    assert.strictEqual(relock.status, 200);
    console.log('reopening a match reopens its round; the round can be confirmed again');

    // force is still there for the moment something goes wrong at a venue:
    // it overrides both the round gate and the configured round count.
    await call('POST', `/api/tournaments/${id}/rounds/unlock`, {}, adminToken);
    const forced = await call('POST', `/api/tournaments/${id}/pair`, { force: true }, adminToken);
    assert.strictEqual(forced.status, 200, 'force must still override the gate');
    const extra = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
    assert.strictEqual(extra.currentRound, 6, 'the forced round exists');

    // Play the forced round out so the event is in a clean state for the cut.
    for (const m of extra.round.matches) {
      if (m.bye) continue;
      await call('POST', `/api/tournaments/${id}/result`, { matchId: m.id, result: 'p1' }, adminToken);
    }
    const sealed = await call('POST', `/api/tournaments/${id}/rounds/lock`, {}, adminToken);
    assert.strictEqual(sealed.status, 200, JSON.stringify(sealed.data));
    console.log('force still overrides the gate when an event needs it to');
  }

  // --- lookup -------------------------------------------------------------
  const look = await call('GET', `/api/tournaments/${id}/player/${idOf.get('Pemain 7')}`);
  assert.strictEqual(look.status, 200);
  assert.ok(look.data.record.rank >= 1 && look.data.record.rank <= 23);
  assert.strictEqual(look.data.player.ptcgId, undefined, 'player lookup must not return a PTCG ID');
  console.log(`player lookup works — Pemain 7 is rank ${look.data.record.rank} of 23`);

  const wrongLook = await call('GET', `/api/tournaments/${id}/player/pnope`);
  assert.strictEqual(wrongLook.status, 404);

  // Turning off open reporting must block self-reports.
  await call('POST', `/api/tournaments/${id}/settings`, { openReporting: false }, adminToken);
  const blocked = await call('POST', `/api/tournaments/${id}/report`, {
    name: 'Pemain 7', code: codeOf.get('Pemain 7'), outcome: 'win',
  });
  assert.strictEqual(blocked.status, 403, 'self-reporting should be blocked when closed');
  await call('POST', `/api/tournaments/${id}/settings`, { openReporting: true }, adminToken);
  console.log('open-reporting toggle blocks and restores self-reporting');

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

  // The moment the cut starts, a player in it must see their BRACKET match and
  // not their last Swiss match. This is the regression that left players with no
  // way to learn their table except the organizer calling it out.
  {
    const cutState = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
    const firstBracket = cutState.cut.rounds[0].matches[0];
    const seatedName = firstBracket.p1;
    const seated = (await call('GET', `/api/tournaments/${id}/player/${idOf.get(seatedName)}`)).data;
    assert.ok(seated.match, `${seatedName} is in the cut and must have a match`);
    assert.strictEqual(seated.match.stage, 'cut', 'the match must be reported as a cut match');
    assert.strictEqual(seated.match.id, firstBracket.id, 'and it must be the bracket match');

    // A player who missed the cut has no match at all, rather than a stale one.
    const eliminated = cutState.standings.find((row) => row.rank > 8 && !row.dropped);
    if (eliminated) {
      const out = (await call('GET', `/api/tournaments/${id}/player/${eliminated.id}`)).data;
      assert.strictEqual(out.match, null, 'a player out of the cut must have no current match');
    }

    // A bracket match can never be reported as a draw.
    const drawInCut = await call('POST', `/api/tournaments/${id}/report`, {
      name: seatedName, code: codeOf.get(seatedName), outcome: 'draw',
    });
    assert.strictEqual(drawInCut.status, 400, 'a bracket match must refuse a draw');
    console.log('top cut is visible to players and refuses draws');
  }

  for (let stage = 0; stage < 3; stage++) {
    const state = (await call('GET', `/api/tournaments/${id}`, null, adminToken)).data;
    const bracketRound = state.cut.rounds[state.cut.rounds.length - 1];
    for (const m of bracketRound.matches) {
      await call('POST', `/api/tournaments/${id}/result`, { matchId: m.id, result: 'p1' }, adminToken);
    }

    // The gate applies to the bracket as well: every match confirmed is not
    // enough, the round itself has to be signed off.
    const early = await call('POST', `/api/tournaments/${id}/cut/advance`, {}, adminToken);
    assert.strictEqual(early.status, 400, 'the bracket must not advance past an unconfirmed round');

    const sealed = await call('POST', `/api/tournaments/${id}/rounds/lock`, {}, adminToken);
    assert.strictEqual(sealed.status, 200, JSON.stringify(sealed.data));

    const advanced = await call('POST', `/api/tournaments/${id}/cut/advance`, {}, adminToken);
    assert.strictEqual(advanced.status, 200, JSON.stringify(advanced.data));
  }
  console.log('the round gate applies to bracket rounds too');

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

  // --- CSV + QR -----------------------------------------------------------
  const csvRes = await fetch(`${BASE}/api/tournaments/${id}/standings.csv`);
  const csv = await csvRes.text();
  const csvLines = csv.trim().split('\r\n');
  assert.strictEqual(csvRes.status, 200);
  assert.strictEqual(csvLines.length, 24, 'CSV should have a header plus 23 players');
  assert.ok(csvLines[0].includes('WOScore'), 'CSV should include WOScore');
  // fetch().text() strips the BOM while decoding, so check the raw bytes.
  const csvBytes = new Uint8Array(await (await fetch(`${BASE}/api/tournaments/${id}/standings.csv`)).arrayBuffer());
  assert.deepStrictEqual([csvBytes[0], csvBytes[1], csvBytes[2]], [0xef, 0xbb, 0xbf],
    'CSV should start with a UTF-8 BOM so Excel reads Indonesian names correctly');
  console.log(`standings CSV exports ${csvLines.length - 1} rows with a UTF-8 BOM`);

  const qrRes = await fetch(`${BASE}/api/tournaments/${id}/qr.svg`);
  const svg = await qrRes.text();
  assert.strictEqual(qrRes.status, 200);
  assert.ok(svg.startsWith('<svg'), 'QR endpoint should return SVG');
  assert.ok(qrRes.headers.get('content-type').includes('image/svg+xml'));
  console.log('QR endpoint returns an SVG for the portal URL');

  // --- static pages all serve --------------------------------------------
  for (const page of ['/', '/portal.html', '/tournament.html', '/qr.html', '/organizer', '/standings.html']) {
    const res = await fetch(BASE + page);
    assert.strictEqual(res.status, 200, `${page} should serve`);
  }
  console.log('all six pages serve');

  // --- round timer and tie-as-double-loss --------------------------------
  {
    const made = await call('POST', '/api/tournaments', {
      name: 'Clock and Double Loss',
      rounds: 3,
      topCut: 0,
      password: 'rahasia123',
      allowDraws: true,
      tieMode: 'doubleLoss',
      timerEnabled: true,
      timerMinutes: 30,
    });
    assert.strictEqual(made.status, 200, JSON.stringify(made.data));
    const t2 = made.data.id;
    const tok2 = made.data.adminToken;

    await call('POST', `/api/tournaments/${t2}/players`,
      { names: ['Andi', 'Budi', 'Citra', 'Dewi'] }, tok2);
    await call('POST', `/api/tournaments/${t2}/pair`, {}, tok2);

    // Pairing a round starts its clock, and it is an absolute instant so every
    // client counts to the same moment rather than to its own countdown.
    const live = (await call('GET', `/api/tournaments/${t2}`)).data;
    assert.ok(live.timer, 'a timed event must expose a round timer');
    assert.strictEqual(live.timer.running, true, 'pairing a round starts its clock');
    assert.ok(live.timer.endsAt, 'a running clock must carry the instant it ends');
    assert.ok(live.timer.leftMs > 29 * 60000 && live.timer.leftMs <= 30 * 60000,
      `30 minutes expected, got ${live.timer.leftMs}ms`);
    assert.ok(live.serverNow, 'clients need the server clock to correct their own');

    const paused = await call('POST', `/api/tournaments/${t2}/rounds/timer`, { action: 'pause' }, tok2);
    assert.strictEqual(paused.status, 200);
    assert.strictEqual(paused.data.timer.running, false);
    const frozen = paused.data.timer.leftMs;
    await new Promise((r) => setTimeout(r, 120));
    const still = (await call('GET', `/api/tournaments/${t2}`)).data;
    assert.strictEqual(still.timer.leftMs, frozen, 'a paused clock must not tick');

    const extended = await call('POST', `/api/tournaments/${t2}/rounds/timer`,
      { action: 'extend', minutes: 5 }, tok2);
    assert.strictEqual(extended.data.timer.leftMs, frozen + 5 * 60000, 'extend adds to the clock');

    const noSuchAction = await call('POST', `/api/tournaments/${t2}/rounds/timer`,
      { action: 'melt' }, tok2);
    assert.strictEqual(noSuchAction.status, 400);
    console.log('round timer: starts with the round, pauses without drift, extends, rejects nonsense');

    // Every board a draw. Under doubleLoss nobody scores and everyone takes a
    // loss — turni.id's event #277, except the organizer can undo it.
    const state2 = (await call('GET', `/api/tournaments/${t2}`, null, tok2)).data;
    for (const m of state2.round.matches) {
      if (m.bye) continue;
      await call('POST', `/api/tournaments/${t2}/result`, { matchId: m.id, result: 'draw' }, tok2);
    }
    const scored = (await call('GET', `/api/tournaments/${t2}`)).data;
    assert.ok(scored.standings.every((row) => row.points === 0), 'a double loss scores nothing');
    assert.ok(scored.standings.every((row) => row.losses === 1), 'and records a loss for both');
    assert.ok(scored.standings.every((row) => row.draws === 0), 'and no draw');
    assert.strictEqual(scored.settings.tieMode, 'doubleLoss');

    // Switching back rescores the same stored results as draws. The reports the
    // players filed are untouched either way.
    await call('POST', `/api/tournaments/${t2}/settings`, { tieMode: 'draw' }, tok2);
    const rescored = (await call('GET', `/api/tournaments/${t2}`)).data;
    assert.ok(rescored.standings.every((row) => row.points === 1), 'as draws, a point each');
    assert.ok(rescored.standings.every((row) => row.draws === 1));
    console.log('tie mode rescores stored results without rewriting what was reported');
  }

  // --- a pre-gate file still opens ---------------------------------------
  if (process.env.DATA_DIR) {
    // A tournament saved before the round lock existed. Two rounds, both fully
    // confirmed, no `locked` field anywhere — exactly what is sitting in data/
    // on the VM right now.
    const legacy = {
      id: 'LEGCY',
      name: 'Saved Before The Gate',
      createdAt: new Date().toISOString(),
      status: 'swiss',
      settings: { rounds: 3, allowDraws: true, topCut: 0, language: 'id', tiebreakers: 'official', openReporting: true },
      passwordSalt: 'ab'.repeat(16),
      passwordHash: 'x'.repeat(128),
      adminToken: 'legacy-token-for-the-e2e-suite',
      players: [
        { id: 'pa', name: 'Satu', code: 'AAAA', seed: 1, dropped: false, arrivedLate: false },
        { id: 'pb', name: 'Dua', code: 'BBBB', seed: 2, dropped: false, arrivedLate: false },
      ],
      rounds: [
        { number: 1, startedAt: new Date().toISOString(), matches: [
          { id: 'r1m1', table: 1, p1: 'pa', p2: 'pb', bye: false, result: 'p1', status: 'confirmed' }] },
        { number: 2, startedAt: new Date().toISOString(), matches: [
          { id: 'r2m1', table: 1, p1: 'pb', p2: 'pa', bye: false, result: 'p1', status: 'confirmed' }] },
      ],
      cut: null,
    };
    fs.writeFileSync(path.join(process.env.DATA_DIR, 'LEGCY.json'), JSON.stringify(legacy, null, 2));

    const opened = (await call('GET', '/api/tournaments/LEGCY', null, legacy.adminToken)).data;
    assert.strictEqual(opened.standings.length, 2, 'a pre-gate file must still open');
    assert.strictEqual(opened.settings.tieMode, 'draw', 'and gain the default tie mode');
    assert.strictEqual(opened.settings.timerEnabled, false, 'with the clock off');
    // Round 1 was plainly finished — something was drawn from it — so it is
    // sealed. Round 2 is the live one and waits for a human.
    assert.strictEqual(opened.round.number, 2);
    assert.strictEqual(opened.round.locked, false, 'the live round still needs signing off');
    const gated = await call('POST', '/api/tournaments/LEGCY/pair', {}, legacy.adminToken);
    assert.strictEqual(gated.status, 400, 'and the gate applies to it immediately');
    console.log('a tournament saved before the gate opens, and joins the gate on its live round');
  }

  console.log('\nEnd-to-end run passed.');
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
