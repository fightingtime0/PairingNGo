# Known issues

Findings from a code read and a full test run (Sept 2026). Nothing here is
fixed — this file exists so none of it gets rediscovered the hard way during
an event.

The engine itself is sound: `npm test` passes, `npm run test:e2e` runs a
23-player event through 5 Swiss rounds and a top 8 bracket, and a simulation of
90 tournaments at sizes 4–200 produced zero forced rematches. Pairing 256
players across 9 rounds takes about 25ms. The problems are at the edges.

---

## Bugs

### 1. Players cannot see the top cut  — highest priority

`currentMatchFor()` in `server.js` only looks at `t.rounds`, never
`t.cut.rounds`. Once the bracket starts, a player looking themselves up sees
their **last Swiss match**, stale, with no indication it is over.

`public/standings.html` never renders `data.cut` either, so the venue screen
keeps showing the final Swiss pairings for the rest of the event.

Net effect: from the moment you cut, the only way a player learns their table
is you saying it out loud. Verified live, not theoretical.

### 2. `POST /settings` does not validate `topCut`

`topCut: -5` is accepted and stored. Cosmetic only — `POST /cut` validates
properly and rejects anything that is not 2, 4, 8, 16 or 32.

### 3. `suggestRounds()` is dead code

`lib/swiss.js` exports it — `ceil(log2(players))` — and no caller exists. The
round count is a free 1–20 number input that ignores how many players are
registered.

---

## Security

None of these are urgent for a single-venue event on a trusted network. They
matter if the box is on the public internet.

### Rate limiting: there is none, anywhere

- **Organizer login.** Brute-forceable. Worse, `hashSecret()` uses
  `crypto.scryptSync`, which blocks the event loop for ~50–100ms per attempt,
  so a login flood is also a cheap denial of service against the whole server.
- **Player report/lookup.** A player's 4-character code is their only
  credential: 27 characters, 4 positions, ~531k combinations. Anyone who knows
  a player's name can brute force it and file a false result. The organizer
  confirmation step catches the damage, but it is noise you do not want
  mid-event.

### The tournament list is public

`GET /api/tournaments` requires no auth and returns every tournament on the
server — codes, names, player counts, status. Fine for a single-organizer box,
and the organizer page uses it as a convenience list. Worth knowing it is
there. Note that a tournament code alone grants nothing: the organizer
password is still required.

### Minimum organizer password is 4 characters

`server.js` enforces `password.length < 4` only.

---

## What the code does well — do not regress these

- **Atomic writes.** Every save goes to a temp file and is then renamed. A
  crash mid-write cannot leave a half-written tournament on disk.
- **Per-tournament write lock.** Two organizer clicks cannot interleave.
- **Two-step result confirmation.** A player's report sets `status: 'pending'`
  and standings do not move until the organizer confirms. This is the direct
  fix for the mass-misclick failure seen on other platforms, where one
  "apply all" wiped a whole round.
- **Correct Play! Pokémon tiebreakers.** 25% floor, 75% cap, and byes excluded
  from both the numerator and the denominator of opponents' win percentage.
- **No XSS.** Every DOM node is built with `textContent`; `innerHTML` is only
  ever assigned `''`.
- **Path traversal is guarded** in `serveStatic()`.

---

## Gaps against the product spec

Measured against the intended TO and player flows.

### Organizer flow

| Spec | Status |
|---|---|
| Register account (name, email, password) | Missing — no user accounts exist at all |
| Login, then Make New / Open Tournaments | Both paths exist, as two panels before login |
| Max player limit | Missing |
| Round Robin or Swiss | Missing — Swiss only |
| Player input via CSV or manual | Manual paste only, one name per line |
| Round count from player count, max 5 | Free number 1–20 |
| Explicit Start button | Missing — the event starts when you pair round 1 |
| List of tournaments you created | Lists everyone's, not yours |
| Open, report, continue | Works |

The blocker is architectural: there is no user concept anywhere in the
codebase. Identity is per-tournament — code plus password. Adding accounts
means a user store, sessions, an owner field on every tournament, and turning
the currently-public tournament list into "mine only".

### Player flow

| Spec | Status |
|---|---|
| Open a link from the TO | Missing — no link, no QR, three fields typed by hand |
| List of rounds (1 to final) | Missing — the API only ever returns the current round |
| Open the round in progress | Satisfied, by virtue of only ever showing that one |
| Report win / loss / draw | Works exactly as specified |
| TO receives the report | Works, and adds a confirmation step the spec did not ask for |

The player entry gap is the cheapest meaningful win: `/?id=CODE` prefilling the
tournament code, plus a printable QR, is a small change. Be deliberate about
whether a per-player link should carry that player's code — it removes all
typing, but the link then *is* the credential and forwarding it hands over the
identity.
