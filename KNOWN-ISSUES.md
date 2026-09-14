# Known issues

Living register. Findings from a code read and a full test run (Sept 2026),
updated 12 Sep 2026 after merging the player portal / QR / turni-mode work, and
again 14 Sep 2026 after lifting the round gate, round timer, tie-as-double-loss
and dark theme across from the single-file Nightshade build.

The engine is sound: `npm test` passes, `npm run test:e2e` runs a 23-player
event through 5 Swiss rounds and a top 8 bracket, and a simulation of 90
tournaments at sizes 4–200 produces zero forced rematches. Pairing 256 players
across 9 rounds takes about 25ms.

---

## Added — 14 Sep 2026

Four ideas taken from the single-file Nightshade build (reviewed 13–14 Sep) and
reimplemented here. Nightshade itself was **not** merged: it has no player
portal, no per-player credential and no organizer password, and from a static
folder it cannot be shared at all.

### The round gate
Every round now carries `locked`. `POST /rounds/lock` sets it, and it is refused
while any match in the round is unconfirmed. `POST /pair`, `POST /cut` and
`POST /cut/advance` all refuse an unlocked round; `POST /result` and
`POST /confirm-all` refuse a locked one. `POST /reopen` clears the lock on the
round the match belongs to, because the organizer's sign-off no longer describes
what is in it.

This is the missing step behind the failure this project exists to hedge
against: an event where all ten boards of one round were marked Double Loss in a
single action, with no undo, leaving the tournament frozen. Per-match
confirmation does not catch that — each board was individually confirmed. What
was missing was a human looking at the **round** before the event advanced past
it.

`{"force": true}` still overrides every gated endpoint. It is on no button and
is documented as the venue escape hatch.

### Round timer
Off by default (`settings.timerEnabled`, `settings.timerMinutes`). Stored as an
**absolute end time** on the round rather than a countdown the server ticks, so
every client counts to the same instant with no per-second writes, and a phone
that slept shows the right figure on wake instead of resuming. Every payload
carries `serverNow` so a device with a wrong clock still agrees with the room.
`POST /rounds/timer` takes start / pause / reset / extend. Locking a round stops
its clock.

### Ties as a double loss
`settings.tieMode` is `'draw'` (unchanged default) or `'doubleLoss'`. The result
is still stored as `'draw'` either way; only `buildRecords()` scores it
differently — 0 points and a loss for both, rather than a point each. Switching
the setting **rescores** existing results and never rewrites them, and switching
back restores the original figures exactly. `allowDraws` remains a separate
question: it decides whether a tie may be reported at all.

### Light and dark themes
`public/app.css` is now fully tokenised — no colour outside the `:root` blocks,
with two deliberate exceptions noted in the file (the printable QR box and the
print stylesheet, both of which must stay black-on-white). Dark is the
Nightshade palette. The theme follows `prefers-color-scheme` unless the reader
picks one, which stamps `data-theme` on `<html>`.

### Not taken: cross-tier elimination pairing
Nightshade pairs the leftovers of odd loss tiers across tiers so a double loss
cannot hand out several free byes. It does not transfer: this build has no
multi-life elimination format — Swiss plus a power-of-two single-elimination cut
— so the odd tiers it fixes never arise. Revisit if elimination formats are ever
added.

### Migration
`migrateTournament()` runs on every read. A file written before any of this
gains the new settings at their defaults, and its rounds are sealed by
inspection: a round something was already drawn past was plainly finished, so it
is locked rather than re-asked, and the live round is left open for a human. The
e2e suite writes a hand-made pre-gate file and asserts it opens, scores and gates
correctly.

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

### A running clock keeps running while the server is down
The end time is absolute, so a round timer does not pause when the process
restarts — which is correct (the players kept playing) but surprising if the box
was down for twenty minutes. Reset or +5 min is the fix in the moment.

### The gate is per-round, not per-stage
Only the live round can be locked or unlocked; there is no way to reopen round 2
of a five-round event without unwinding the rounds after it. Nightshade
truncates everything drawn after a reopened round. Here the rounds are paired one
at a time, so the situation is rarer, but a mistake found two rounds late still
has no clean path back short of editing the JSON.

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
  and standings do not move until the organizer confirms.
- **The round gate on top of it.** Confirming every match is not the same as
  signing the round off, and only the second one lets the event advance. Between
  them these are the direct fix for the mass-misclick failure seen on other
  platforms, where one "apply all" wiped a whole round with no way back. Keep
  them as two separate acts — collapsing them back into one is the regression.
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
