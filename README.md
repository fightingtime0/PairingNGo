# Onic TCG Tournament

A self-hosted Swiss tournament system for Pokémon TCG events. Built as a fallback
you control, so it is deliberately plain: **no dependencies at all**, no database
server, no build step. Just Node and a folder of JSON files.

- Organizer console for running the event
- Player page where people look up their table with a name and a 4-character code
- Swiss pairings with the Play! Pokémon tiebreakers
- Single-elimination top cut
- Indonesian and English, switchable
- One-click backup download

## What is in here

```
server.js          the whole server
lib/swiss.js       pairing, standings, tiebreakers, bracket
lib/test.js        engine tests
lib/e2e.js         end-to-end HTTP test (needs a server on :3999)
lib/e2e-run.js     starts that server for you, then runs e2e.js
public/            the three pages
data/              tournaments, one JSON file each (created on first run)
deploy/            systemd unit, nginx config, setup script
start.bat          double-click launcher for Windows
```

`data/` is gitignored. It holds organizer password hashes and admin tokens —
do not commit it.

## Run it locally first

```bash
node server.js
```

Open http://localhost:3000. Everything works without a server, so test the whole
flow on your laptop before you deploy.

Run the tests any time with:

```bash
npm test          # engine tests: tiebreakers, byes, pairing, bracket seeding
npm run test:e2e  # full HTTP run against a throwaway server on port 3999
```

`npm run test:e2e` starts and stops its own server in a temp directory. Running
`node lib/e2e.js` directly expects one to already be listening on 3999 and
fails with a bare `fetch failed` if it is not.

Note the server binds `0.0.0.0`, not just localhost, so anyone on the same
wifi can reach it at your machine's LAN IP. Handy for testing on a phone,
worth knowing before you open it on a cafe network.

---

## Deploying to the Oracle server

### The short version

```bash
git clone YOUR_REPO_URL ~/onic-tournament
cd ~/onic-tournament
bash deploy/setup.sh
```

That installs Node if needed, runs the tests, registers the systemd service and
opens the instance firewall. It works on Oracle Linux and Ubuntu, on x86 and on
ARM/Ampere — there are no native dependencies, so nothing needs compiling.

Two things it deliberately leaves to you: the **VCN ingress rule** in the Oracle
web console (step 4a below) and **nginx + TLS** (step 5), which needs your domain.

The rest of this section is what the script does, by hand.

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

### 2. Get the files onto the server

```bash
git clone YOUR_REPO_URL ~/onic-tournament
cd ~/onic-tournament
```

The SSH username is `opc` on Oracle Linux images and `ubuntu` on Ubuntu images.

To update later: `git pull && sudo systemctl restart onic-tournament`. Your
`data/` directory is gitignored, so pulling never touches live tournaments.

### 3. Run it as a service so it survives reboots

```bash
sudo cp deploy/onic-tournament.service /etc/systemd/system/
sudo sed -i "s|__USER__|$USER|g; s|__DIR__|$PWD|g" /etc/systemd/system/onic-tournament.service
sudo systemctl daemon-reload
sudo systemctl enable --now onic-tournament
sudo systemctl status onic-tournament
```

Logs: `sudo journalctl -u onic-tournament -f`

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
sudo cp deploy/nginx.conf /etc/nginx/conf.d/onic.conf
sudo sed -i 's/turnamen.example.com/YOUR.DOMAIN/' /etc/nginx/conf.d/onic.conf
sudo nginx -t && sudo systemctl reload nginx
```

**On Oracle Linux, do this or every single request returns 502:**

```bash
sudo setsebool -P httpd_can_network_connect 1
```

SELinux ships enforcing on Oracle Linux images and blocks nginx from opening a
socket to `127.0.0.1:3000`. The config is correct, nginx starts fine, `nginx -t`
passes — and you get 502 on every request with `Permission denied` in
`/var/log/nginx/error.log`. This one wastes an afternoon if you don't know it.
Ubuntu images use AppArmor and are not affected.

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
2. Paste your player list, one name per line. Every player gets a 4-character code.
3. Print the code sheet, or read codes out at sign-in.
4. Pair round 1.
5. Players open the site, enter tournament code + their name + their code, and see
   their table. They report their own result; you confirm it.
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

Standings sort by match points (win 3, draw 1, loss 0), then Opponents' Win %,
then Opponents' Opponents' Win %, then head-to-head, then late arrival.

Each opponent's win percentage is their wins plus half their draws, divided by the
rounds they played, with a floor of 25% and a ceiling of 75%. Byes are excluded
entirely — a bye awards 3 points but is not a win and does not count as a round
played. This follows the Play! Pokémon tournament rules handbook.

## Known issues

Read [KNOWN-ISSUES.md](KNOWN-ISSUES.md) before you run a real event on this.
The short version: the Swiss engine is solid and well tested, but **players
cannot see the top cut** — once the bracket starts, both the player page and
the venue screen keep showing stale Swiss data, so you will be calling tables
out loud. There is also no rate limiting anywhere.

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
