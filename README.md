# Clash Ledger

Configured for clan **#2PYYVR0PP**. The Node service polls the official Clash of Clans API every five minutes, saves war, CWL, and donation history on disk, and the dashboard checks for updates every minute. Donation entries are stored on the server too. The dashboard uses the blue palette, highlights members who attacked in the most recent war in green, and only shows API or recorded values; it does not invent performance figures.

## Individual player profiles

Click a player's name in the member roster or leaderboard to view
their individual profile, including:

- Player tag, clan role, and Town Hall level.
- Donations given and received.
- Daily donation history.
- Individual war stars and attacks.
- Regular war and Clan War League history.

Player statistics respect the dashboard's selected date range.
All statistics come from official API data and previously recorded
history. Players cannot manually modify their statistics.

## SQLite database storage

Historical donation records, regular wars, CWL records,
and cached clan snapshots are stored in a SQLite database
located at `data/clash-ledger.sqlite`.

On first startup, the server automatically imports existing
JSON history files into SQLite. The original files are
retained and are not overwritten or deleted.

The database uses transactions to prevent partially saved
updates and prepared statements for database operations.

All statistics continue to come from the official Clash
of Clans API. Manual donation submissions remain disabled.

Keep the data directory on persistent storage, maintain
regular backups, and run only one server instance against
the database.

Node.js 24 or newer is required.

## Requirements before live updates work

- A host that stays online and has a **static public outbound IPv4 address**. Supercell binds API keys to an allowed IP, so a typical serverless host with changing egress IPs will not work reliably.
- Node.js 24 or newer.
- A Clash of Clans API key from [the official developer portal](https://developer.clashofclans.com/), with the host's static outbound IP on its allowed IP list.

The API key is a server secret. Never add it to `index.html`, commit it, or share it in chat.

## Run locally

PowerShell:

```powershell
$env:COC_API_TOKEN = "paste-your-api-key-here"
npm start
```

macOS/Linux:

```sh
COC_API_TOKEN="paste-your-api-key-here" npm start
```

Then open `http://localhost:3000`. Set `COC_CLAN_TAG` to change the clan, `COC_POLL_MS` to change the polling interval (minimum one minute), and `DATA_DIR` to choose a persistent data directory for the snapshot and donation log.

## Keep it running on a Linux VPS

1. Choose a small VPS with a static outbound IP. Add that IP to the API key's allowed IP list.
2. Copy this `outputs` folder to the server and install Node.js 24 or newer.
3. Create a service account and a persistent writable data directory. Set `COC_API_TOKEN` in the service manager's secret/environment configuration; do not store it in the web root.
4. Run `node server.js` under a process manager such as systemd, configure automatic restart on failure and startup at boot, and put a TLS reverse proxy in front of port 3000 before exposing it to the public internet.
5. Keep the data directory on persistent storage. It contains the current clan snapshot and donation log.

The service exposes `GET /api/clan` and `GET/POST /api/donations`. API data is refreshed on the server every five minutes; dashboards refresh their view every minute. A cached snapshot remains available if a later poll fails. Each date range filters the war list and donation dashboard. Donation history adds the change in each member's API totals to a persistent daily ledger. At first startup, the current API totals are saved as a starting balance; previous calendar-year donation totals are not supplied by the official API, so the dashboard shows the tracking start date and does not claim a complete pre-install year. The official API exposes member donation totals, not individual troop donation events, so the event log still records donations manually.

Regular war history is available only when the clan's War Log is public. The current API response for this clan reports `isWarLogPublic: false`. Make the War Log public in Clash of Clans to let the tracker read clan-level war results. The official war log does not contain each member's attacks; the tracker saves member-level attacks when it can poll an active war. It cannot reconstruct participant lists for wars that ended before tracking began.

The official API exposes the current CWL group, not a complete past-season archive. The tracker saves each CWL round it observes while the server is running. Older CWL seasons from before tracking began cannot be filled from the official API. The dashboard keeps previous observed seasons and displays the current group when Supercell returns one.

After changing `server.js`, restart the running process with `Ctrl+C` in its PowerShell window and run `npm start` again. Reload the page after the server starts. Your history files are stored under `data/`; keep this directory on persistent storage.
