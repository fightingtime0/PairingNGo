# Onic TCG Tournament

A self-hosted Swiss tournament system for Pokémon TCG events. Built as a fallback
you control, so it is deliberately plain: **no dependencies at all**, no database
server, no build step. Just Node and a folder of JSON files.

- Public tournament list, standings, pairings and bracket — no login to view
- Player portal with QR code: players find themselves by name or PTCG ID
- Organizer console for running the event
- Swiss pairings with a choice of two tiebreaker systems
- Single-elimination top cut
- Standings export to CSV
- Indonesian and English, switchable
- One-click backup download

## What is in here

```
server.js            the whole server
package.json         npm scripts only — there are no dependencies
install.sh           one-command deploy for Ubuntu or Oracle Linux
start.bat            double-click local run on Windows
deploy/setup.sh      the same deploy, split into reviewable pieces
deploy/nginx.conf    reverse proxy config
deploy/onic-tournament.service   systemd unit
lib/swiss.js         pairing, standings, tiebreakers, bracket
lib/qr.js            QR encoder (no dependency, outputs SVG)
lib/test.js          engine tests
lib/e2e.js           end-to-end HTTP test (expects a server on :3999)
lib/e2e-run.js       starts that server, runs e2e.js, cleans up
public/index.html    tournament list
public/tournament.html  public standings, rounds, players, top cut
public/portal.html   player portal
public/qr.html       printable QR sheet
public/organizer.html   organizer console
public/standings.html   big-screen display
data/                tournaments, one JSON file each (created on first run)
KNOWN-ISSUES.md      live register of bugs, fixes and gaps — read before an event
```

## Run it locally first

```bash
node server.js
```

Open http://localhost:3000. Everything works without a server, so test the whole
flow on your laptop before you deploy.

Run the tests any time with:

```bash
npm test          # engine tests
npm run test:e2e  # full HTTP run on a throwaway server and data directory
```

`npm run test:e2e` starts its own server on port 3999 with a temporary data
directory and cleans up after itself, so it never touches your real `data/`.

---

## Deploying to the Oracle server

### 1. Install Node

Check what you have first:

```bash
cat /etc/os-release
node --version
```

**Ubuntu:**
```bash
sudo apt update
sudo apt install -y nodejs npm
```
If that gives you Node older than 18:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

**Oracle Linux:**
```bash
sudo dnf module reset nodejs -y
sudo dnf module enable nodejs:22 -y
sudo dnf install -y nodejs
```

### 2. Copy the files up

From your Mac, in the folder containing `onic-tournament`:

```bash
scp -r onic-tournament opc@YOUR_SERVER_IP:~/
```

The username is `opc` on Oracle Linux images and `ubuntu` on Ubuntu images.

### 3. Run it as a service so it survives reboots

```bash
sudo tee /etc/systemd/system/onic-tournament.service > /dev/null <<'EOF'
[Unit]
Description=Onic TCG Tournament
After=network.target

[Service]
Type=simple
User=USERNAME
WorkingDirectory=/home/USERNAME/onic-tournament
Environment=PORT=3000
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo sed -i "s/USERNAME/$USER/g" /etc/systemd/system/onic-tournament.service
sudo systemctl daemon-reload
sudo systemctl enable --now onic-tournament
sudo systemctl status onic-tournament
```

`Restart=always` means if the process ever crashes mid-event it comes straight
back up, and because tournaments are written to disk after every change, nothing
is lost.

### 4. Open the port — both places

This is the step people get wrong on Oracle, because there are **two** firewalls
and blocking either one produces the same symptom of a page that never loads.

**a. The VCN security list**, in the Oracle Cloud web console:
Networking → Virtual Cloud Networks → your VCN → Subnets → your subnet →
Security Lists → Default Security List → Add Ingress Rule.
Source `0.0.0.0/0`, IP protocol TCP, destination port 80 and 443.

**b. The firewall on the instance itself:**

Oracle Linux:
```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

Ubuntu (Oracle's Ubuntu images ship with restrictive iptables rules):
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

### 5. Put it on port 80/443 with a real address

Running Node directly on port 80 is possible but not ideal. Use nginx in front:

```bash
# Ubuntu
sudo apt install -y nginx
# Oracle Linux
sudo dnf install -y nginx && sudo systemctl enable --now nginx
```

```bash
sudo tee /etc/nginx/conf.d/onic.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name turnamen.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx
```

Replace `turnamen.example.com` with your domain and point an A record at the
server's public IP. Then add HTTPS:

```bash
# Ubuntu
sudo apt install -y certbot python3-certbot-nginx
# Oracle Linux
sudo dnf install -y certbot python3-certbot-nginx

sudo certbot --nginx -d turnamen.example.com
```

Certbot renews automatically. Players will not trust a site that warns them, and
several phone browsers block form submission over plain HTTP, so do not skip this.

---

## Running an event

1. Open `/organizer`, create the tournament, note the 5-character code.
2. Paste your player list, one name per line. To record PTCG IDs, put the ID after
   a comma: `Rizky Pratama, id11340289`.
3. Open the QR sheet and print it, or put it on a screen at the door. Players scan
   it to reach the portal. The sheet carries the *event*, not an identity, so it
   is safe to put on a wall.
4. Pair round 1.
5. Players find their name in the portal and see their table. They report their own
   result; you confirm it.
6. Confirm everything, pair the next round, repeat.
7. Start the top cut when Swiss is done.

Round count is editable at any time — raise it mid-event if more people turn up
than you expected.

Put `/standings.html?id=YOURCODE` on a monitor at the venue. It alternates between
standings and current pairings, no interaction needed.

### Things worth knowing

- **Standings only move on confirmed results.** A player reporting does not change
  anything until you press confirm. Rows waiting on you are highlighted.
- **Late arrivals** are automatically flagged if added after round 1, and are ranked
  below on-time players when everything else is tied.
- **Dropping** a player keeps their earlier results in everyone's tiebreakers, which
  is correct. Removing is only possible before round 1.
- **Re-pair** is available until you confirm a result in that round.
- **Download backup** before each round. It is a plain JSON file. If the server dies
  you still have every result, and you can finish on paper.

## Tiebreakers

There are two modes, set per tournament, because they do not always agree.

**Official handbook.** Match points, then Opponents' Win %, then Opponents'
Opponents' Win %, then head-to-head, then late arrival. An opponent's win
percentage is their wins plus half their draws over rounds played, floored at
25%, and capped at **100% for a player who completed the event, 75% for one who
dropped**. This is what the Play! Pokémon tournament rules handbook specifies —
note the two different ceilings, which is easy to get wrong. Capping everyone at
75% under-credits the opponents of anyone undefeated, and that is the top of the
standings where the cut is decided.

One caveat on this mode's name. The handbook makes **tardiness the first
tiebreaker**, ahead of Op Win %; this engine applies it late, after head-to-head,
as listed above. The ordering moved between handbook revisions, so confirm which
revision your scene plays under before relying on it.

**Match turni.id.** Match points, then OMW%, then AVOMW%, then head-to-head, then
WOScore. Here an opponent's win percentage is their match points over the maximum
available match points, with no floor and no cap — so a draw counts as a third of
a win rather than half, and figures below 25% are possible. WOScore is the raw
total of your opponents' match points, used to split ties where the rounded
percentages match.

The second mode was reverse-engineered from turni.id's published standings, not
from any documentation. Two observations drove it: a player showing 24.0% OMW,
which is impossible under a 25% floor, and WOScore landing on exactly OMW × 75
across a whole 5-round event. The test suite asserts that relationship still
holds. If turni.id changes its formula, this mode will drift out of agreement.

In both modes, byes award 3 points but do not count as a win and are excluded from
win-percentage calculations entirely.

**These two orderings differ in practice.** On simulated 32-player data the modes
rank roughly six players differently. Pick one per event and stick to it.

## Self-reporting

Players report their own result from the portal and the organizer confirms it.
Standings never move on an unconfirmed result.

**Reading is open, writing is not.** Anyone can scan the QR, find their name and
see their table — no credential, no typing beyond their name. Filing a result
additionally requires the player's own four-character code, the one printed on
the slip you hand them at registration. The portal remembers it per event, so it
is typed once.

That split matters. Without the code, the internal player id returned by the name
search would be enough for anyone holding the event code to file a result as
somebody else, and your confirmation queue would show it under that player's
name. Reading is harmless; writing is what needs authorising.

The Settings panel still has a switch to turn self-reporting off entirely, which
makes the organizer enter every result. Use it if you would rather not hand out
slips at all.

## Maintenance

There are no dependencies, so there is nothing to update and no security advisories
to track. The only upkeep is the operating system itself:

```bash
sudo apt update && sudo apt upgrade -y     # Ubuntu
sudo dnf upgrade -y                        # Oracle Linux
```

Because this is a fallback, **test it before every event you might need it for**.
Open the site, create a dummy tournament with four players, pair a round. Two
minutes. An untested backup is not a backup.

Back up the whole thing by copying the data folder:

```bash
tar czf onic-backup-$(date +%F).tar.gz ~/onic-tournament/data
```

### If your always-free instance gets reclaimed

Oracle has historically reclaimed idle always-free compute. Verify the current
policy for your instance, because a reclaimed server is exactly the failure this
project exists to prevent. Keep a copy of this folder on your Mac so you can
redeploy anywhere in about ten minutes.
