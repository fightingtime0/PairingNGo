# Known issues

Living register. Findings from a code read and a full test run (Sept 2026),
updated 12 Sep 2026 after merging the player portal / QR / turni-mode work and
fixing what that merge exposed.

The engine is sound: `npm test` passes, `npm run test:e2e` runs a 23-player
event through 5 Swiss rounds and a top 8 bracket, and a simulation of 90
tournaments at sizes 4–200 produces zero forced rematches. Pairing 256 players
across 9 rounds takes about 25ms.

---

## Fixed — 12 Sep 2026

Kept here rather than deleted, so nothing gets re-broken by a future merge.

### Self-reporting had lost its credential
`POST /report` accepted a bare internal `playerId`, and the public `/search`
endpoint returned exactly those ids. Knowing only the 5-character event code —
which is printed on the door QR — was enough to file a result as any player,
and the organizer's queue showed it as "reported by <that player>".
**Now:** `/report` requires name + the player's own 4-character code again
(`findPlayer()`), `/search` returns names only, and the e2e suite asserts that a
bare player id and a wrong code are both refused.

### PTCG IDs were public
`/search`, the public standings, the player lookup and the public CSV all
carried them. These are real-world Pokémon account identifiers.
**Now:** organizer-only. The public CSV drops the column entirely; the e2e suite
asserts no public surface returns one.

### Players could not see the top cut
`currentMatchFor()` read only `t.rounds`, so once the bracket started a player
looking themselves up saw their last Swiss match, stale, with nothing to say it
was over. `standings.html` never rendered `data.cut` either, so the venue screen
showed final Swiss pairings for the rest of the event.
**Now:** `currentMatchFor()` reads the bracket when `status === 'cut'` and
returns a `stage` field; the portal labels it Top Cut; `standings.html` rotates
the bracket in and drops the stale Swiss pairings out. A bracket match also
refuses a self-reported draw. Covered by e2e.

### Win percentage capped at 75% for everyone
The handbook sets **100% for a player who completed** the event and 75% only for
one who **dropped**. Capping everybody at 75% under-credited the opponents of
anyone undefeated — the top of the standings, where the cut is decided. A 3-0
finisher contributed 75% instead of 100%.
**Now:** `WIN_PCT_CAP_COMPLETED` / `WIN_PCT_CAP_DROPPED`, chosen by
`record.dropped`. *(This previously sat in the "does well" list below. It was
wrong there.)*

### Login was a free denial of service
No rate limiting anywhere, and `crypto.scryptSync` blocked the event loop ~52ms
per attempt. Measured: 15 concurrent attempts took an unrelated `GET` from 1.9ms
to **584ms**.
**Now:** async `crypto.scrypt`, gated to 2 concurrent hashes so the libuv thread
pool stays free for file I/O, plus a per-IP throttle (10 attempts / 15 min)
counted *before* the password check so a simultaneous burst cannot slip through
together. Re-measured: **14ms** during a 30-request flood, with 20 of the 30
refused at 429 without ever hashing.

### `POST /settings` did not validate `topCut`
`topCut: -5` was accepted and stored. **Now:** must be 0, 2, 4, 8, 16 or 32.

---

## Open

### `suggestRounds()` is effectively dead code
`lib/swiss.js` exports it — `ceil(log2(players))` — and only the test file calls
it. The round count is a free 1–20 number input that ignores how many players
are registered. `suggestCut()` is in the same position.

### Tardiness is in the wrong place in the tiebreaker order
The handbook makes tardiness the **first** tiebreaker, ahead of Op Win %. This
engine applies it late, after head-to-head, and the README documents it that
way. The ordering moved between handbook revisions — **confirm which revision
the local scene plays under before changing this.** Flagged in the `swiss.js`
header comment.

### Head-to-head inside the sort comparator is not transitive
With three or more players tied, the final order can depend on comparison
order. Standard hazard of head-to-head tiebreaks; only bites on exact ties.

### Pairing backtracking is unbounded
`findPairs()` has no timeout or node cap. At realistic round counts it is very
fast (under 10ms for 8–64 players across 12 rounds). One 2.2-second round was
observed once at 32 players / 31 rounds — far past any real event — and did not
reproduce. Worth a node cap eventually, not urgent.

### The tournament list is public
`GET /api/tournaments` requires no auth and returns every tournament on the
server — codes, names, player counts, status. Fine for a single-organizer box.
A tournament code alone now grants nothing: the organizer password is still
required, and reporting needs a player code.

### Minimum organizer password is 4 characters
`server.js` enforces `password.length < 4` only.

### Plain HTTP by default
`deploy/setup.sh` and `install.sh` both finish on port 80 with no certificate;
HTTPS is a documented follow-up step. The organizer token crosses the wire in
the clear until certbot has run. **Do not skip it on venue wifi.**

---

## What the code does well — do not regress these

- **Atomic writes.** Every save goes to a temp file and is then renamed. A crash
  mid-write cannot leave a half-written tournament on disk.
- **Per-tournament write lock.** Two organizer clicks cannot interleave.
- **Two-step result confirmation.** A player's report sets `status: 'pending'`
  and standings do not move until the organizer confirms. This is the direct fix
  for the mass-misclick failure seen on other platforms, where one "apply all"
  wiped a whole round.
- **Byes excluded from win percentage.** Handbook: *"rounds in which a player
  received a random bye … this round is not considered at all."* Excluded from
  both numerator and denominator, and awarded 3 points without counting a win.
  This is correct — do not "fix" it.
- **No XSS.** Every DOM node is built with `textContent` / `createTextNode`;
  `innerHTML` is only ever assigned `''`.
- **Path traversal is guarded** in `serveStatic()`. Verified against `/../`,
  `/..%2f`, `/%2e%2e/` and encoded variants.
- **Credentials stripped from the backup export.**
- **No dependencies.** Nothing to update, no advisories to track. The QR encoder
  in `lib/qr.js` is written from scratch — Reed–Solomon, all 8 mask patterns,
  penalty scoring.

---

## Gaps against the product spec

### Organizer flow

| Spec | Status |
|---|---|
| Register account (name, email, password) | Missing — no user accounts exist at all |
| Login, then Make New / Open Tournaments | Both paths exist, as two panels before login |
| Max player limit | Missing |
| Round Robin or Swiss | Missing — Swiss only |
| Player input via CSV or manual | Manual paste, one name per line, `Name, id12345678` supported |
| Round count from player count, max 5 | Free number 1–20 |
| Explicit Start button | Missing — the event starts when you pair round 1 |
| List of tournaments you created | Lists everyone's, not yours |
| Open, report, continue | Works |

The blocker is architectural: there is no user concept anywhere in the codebase.
Identity is per-tournament — code plus password. Adding accounts means a user
store, sessions, an owner field on every tournament, and turning the currently
public tournament list into "mine only".

### Player flow

| Spec | Status |
|---|---|
| Open a link from the TO | **Done** — printable QR sheet at `/qr.html?tid=CODE` |
| List of rounds (1 to final) | Missing — the API only returns the current round |
| Open the round in progress | Satisfied |
| Report win / loss / draw | Works, with the player's code |
| TO receives the report | Works, and adds a confirmation step the spec did not ask for |

Reading stays open — scan the QR, find your name, see your table, no credential.
Writing needs the code. Keep that split: the shared door QR carries the *event*,
never an identity. A per-player QR that embeds the player's own code would remove
the last typing step, but that link then **is** the credential, and forwarding it
hands over the identity.
