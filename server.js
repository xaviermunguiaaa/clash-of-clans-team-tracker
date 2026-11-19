// Hosted Clash Ledger service: polls Supercell and serves the latest saved snapshot.
// Keep COC_API_TOKEN in the host's secret/environment settings, never in the browser.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.COC_API_TOKEN;
const CLAN_TAG = process.env.COC_CLAN_TAG || '#2PYYVR0PP';
const POLL_MS = Math.max(60_000, Number(process.env.COC_POLL_MS || 300_000));
const root = __dirname;
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const snapshotFile = path.join(dataDir, 'clan-snapshot.json');
const donationsFile = path.join(dataDir, 'donations.json');
const historyFile = path.join(dataDir, 'tracker-history.json');
let snapshot = null;
let lastError = null;
let polling = false;

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}
snapshot = loadJson(snapshotFile, null);
let donations = loadJson(donationsFile, []);
let history = loadJson(historyFile, {
  trackingStartedAt: null,
  donationBaseline: null,
  lastDonationTotals: {},
  donationDeltas: [],
  wars: {},
  cwlWars: {},
  warLogBackfill: { year: null, cursor: null, complete: false },
});

function cocTimestamp(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z$/);
  if (match) return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6], +(match[7] || '0').padEnd(3, '0').slice(0, 3))).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function recordDonations(clan) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const roster = clan.memberList || [];
  if (!history.trackingStartedAt) history.trackingStartedAt = now.toISOString();
  if (!history.donationBaseline) {
    history.donationBaseline = {
      at: now.toISOString(),
      players: roster.map(m => ({ tag: m.tag, name: m.name, donated: Number(m.donations || 0), received: Number(m.donationsReceived || 0) })),
    };
    history.lastDonationTotals = Object.fromEntries(roster.map(m => [m.tag, { name: m.name, donated: Number(m.donations || 0), received: Number(m.donationsReceived || 0) }]));
    return;
  }
  for (const member of roster) {
    const current = { name: member.name, donated: Number(member.donations || 0), received: Number(member.donationsReceived || 0) };
    const previous = history.lastDonationTotals[member.tag];
    if (!previous) {
      history.donationBaseline.players.push({ tag: member.tag, ...current });
    } else {
      const donated = current.donated >= previous.donated ? current.donated - previous.donated : current.donated;
      const received = current.received >= previous.received ? current.received - previous.received : current.received;
      if (donated || received) history.donationDeltas.push({ date: day, at: now.toISOString(), tag: member.tag, name: current.name, donated, received });
    }
    history.lastDonationTotals[member.tag] = current;
  }
}

function recordWar(target, war, source, season) {
  if (!war?.clan || !war?.opponent) return;
  const startTime = cocTimestamp(war.startTime || war.preparationStartTime);
  const endTime = cocTimestamp(war.endTime);
  const sides = [war.clan.tag, war.opponent.tag].sort().join('|');
  const key = `${sides}|${startTime || endTime || war.state || 'unknown'}`;
  const existing = target[key] || {};
  target[key] = {
    ...existing, ...war, startTime, endTime, source,
    season: season || war.season || existing.season || null,
    lastSeenAt: new Date().toISOString(),
  };
}

async function fetchWarLog(tag, clan) {
  if (!clan.isWarLogPublic) return { items: [], error: 'War Log is private.' };
  if (!history.warLogBackfill || typeof history.warLogBackfill.complete !== 'boolean') history.warLogBackfill = { cursor: null, complete: false };
  const items = [];
  let cursor = history.warLogBackfill.complete ? null : history.warLogBackfill.cursor;
  const maxPages = history.warLogBackfill.complete ? 1 : 8;
  try {
    for (let pageNo = 0; pageNo < maxPages; pageNo++) {
      const query = new URLSearchParams({ limit: '25' });
      if (cursor) query.set('after', cursor);
      const page = await coc(`/clans/${tag}/warlog?${query}`);
      const pageItems = page.items || [];
      items.push(...pageItems);
      for (const war of pageItems) recordWar(history.wars, war, 'warLog');
      const next = page.paging?.cursors?.after || null;
      if (!next) {
        history.warLogBackfill = { cursor: null, complete: true };
        break;
      }
      cursor = next;
      history.warLogBackfill = { cursor, complete: false };
    }
    return { items, error: null };
  } catch (error) {
    return { items, error: error.message };
  }
}

async function coc(endpoint) {
  const response = await fetch(`https://api.clashofclans.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `Clash API returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function refresh() {
  if (polling || !TOKEN) return;
  polling = true;
  const tag = encodeURIComponent(CLAN_TAG);
  try {
    const [clan, war, league] = await Promise.allSettled([
      coc(`/clans/${tag}`), coc(`/clans/${tag}/currentwar`), coc(`/clans/${tag}/currentwar/leaguegroup`),
    ]);
    if (clan.status === 'rejected') throw clan.reason;
    const warLogResult = await fetchWarLog(tag, clan.value);
    const warLog = warLogResult.items;
    const warLogError = warLogResult.error;
    const leagueGroup = league.status === 'fulfilled' ? league.value : null;
    const cwlTags = [...new Set((leagueGroup?.rounds || []).flatMap(round => round.warTags || []).filter(tag => tag && tag !== '#0'))];
    const cwlResults = [];
    // Keep requests bounded during league week; a group can contain many round wars.
    for (let i = 0; i < cwlTags.length; i += 4) {
      cwlResults.push(...await Promise.allSettled(cwlTags.slice(i, i + 4).map(warTag => coc(`/clanwarleagues/wars/${encodeURIComponent(warTag)}`))));
    }
    recordDonations(clan.value);
    if (war.status === 'fulfilled' && war.value?.state !== 'notInWar') recordWar(history.wars, war.value, 'currentWar');
    const cwlWars = cwlResults.filter(result => result.status === 'fulfilled').map(result => result.value);
    for (const cwlWar of cwlWars) recordWar(history.cwlWars, cwlWar, 'cwl', leagueGroup?.season);
    saveJson(historyFile, history);
    const fresh = {
      clan: clan.value,
      currentWar: war.status === 'fulfilled' ? war.value : null,
      warLog,
      warLogError,
      leagueGroup,
      cwlWars,
      warError: war.status === 'rejected' ? war.reason.message : null,
      leagueError: league.status === 'rejected' ? (league.reason.status === 404 ? 'No active Clan War League group is available right now.' : league.reason.message) : null,
      updatedAt: new Date().toISOString(),
      history: {
        trackingStartedAt: history.trackingStartedAt,
        donationBaseline: history.donationBaseline,
        donationDeltas: history.donationDeltas,
        wars: Object.values(history.wars),
        cwlWars: Object.values(history.cwlWars),
      },
    };
    snapshot = fresh;
    lastError = null;
    saveJson(snapshotFile, snapshot);
    console.log(`Clan snapshot refreshed at ${fresh.updatedAt}`);
  } catch (error) {
    lastError = error.message;
    console.error(`Clash API refresh failed: ${lastError}`);
  } finally { polling = false; }
}

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/clan' && req.method === 'GET') {
    return send(res, snapshot ? 200 : 503, snapshot
      ? { ...snapshot, lastError }
      : { error: lastError || (TOKEN ? 'Waiting for the first Clash API refresh.' : 'Missing COC_API_TOKEN.') });
  }
  if (url.pathname === '/api/donations' && req.method === 'GET') return send(res, 200, donations);
  if (url.pathname === '/api/donations' && req.method === 'POST') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 10_000) req.destroy(); });
    req.on('end', () => {
      try {
        const entry = JSON.parse(raw);
        if (!entry.name || !entry.troop || !Number.isInteger(Number(entry.qty)) || Number(entry.qty) < 1)
          return send(res, 400, { error: 'Player, troop, and a positive quantity are required.' });
        donations.unshift({ name: String(entry.name).slice(0, 60), troop: String(entry.troop).slice(0, 80), qty: Number(entry.qty), when: new Date().toISOString() });
        donations = donations.slice(0, 1000);
        saveJson(donationsFile, donations);
        return send(res, 201, donations[0]);
      } catch { return send(res, 400, { error: 'Invalid donation entry.' }); }
    });
    return;
  }
  const relative = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(resolved, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const type = resolved.endsWith('.html') ? 'text/html; charset=utf-8'
      : resolved.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : resolved.endsWith('.css') ? 'text/css; charset=utf-8'
      : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store, no-cache, must-revalidate' }); res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Clash Ledger listening on port ${PORT} for ${CLAN_TAG}; polling every ${POLL_MS / 1000}s`);
  refresh();
  setInterval(refresh, POLL_MS);
});
