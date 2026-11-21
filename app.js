const state = {
    snapshot: null,
    history: {}
};
const number = value => Number(value || 0).toLocaleString();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const dayKey = date => {
    if (date == null || date === '') return '';

    const d = new Date(date);

    return Number.isNaN(d.getTime())
        ? ''
        : d.toISOString().slice(0, 10);
};
function gameDate(value) { if (!value) return null; const m = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z$/); if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +(m[7] || '0').padEnd(3, '0').slice(0, 3))); const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d }
function tag() { return String(state.snapshot?.clan?.tag || '').toUpperCase() }
function warDate(w) { return gameDate(w.endTime) || gameDate(w.startTime) || gameDate(w.preparationStartTime) }
function warKey(w) { const sides = [w.clan?.tag || '', w.opponent?.tag || ''].sort().join('|'); const date = warDate(w); return `${sides}|${date ? dayKey(date) : (w.startTime || w.endTime || w.preparationStartTime || 'unknown')}`.toUpperCase() }
function sideFor(w) { const t = tag(); if ((w.clan?.tag || '').toUpperCase() === t) return { mine: w.clan, other: w.opponent }; if ((w.opponent?.tag || '').toUpperCase() === t) return { mine: w.opponent, other: w.clan }; return null }
function allWars(kind = 'all') { const map = new Map(); const quality = w => { const members = w.clan?.members || []; const attacks = members.reduce((n, m) => n + (m.attacks || []).length, 0); return members.length * 1000 + attacks * 20 + (w.state === 'warEnded' ? 500 : 0) + (w.state === 'inWar' ? 100 : 0) }; const add = (w, type) => { const side = sideFor(w); if (!side) return; const item = { ...w, ...side, kind: type }; const key = `${type}|${warKey(w)}`; const previous = map.get(key); if (!previous || quality(w) > quality(previous)) map.set(key, item) }; for (const w of Object.values(state.history.wars || {})) add(w, 'regular'); for (const w of Object.values(state.history.cwlWars || {})) add(w, 'cwl'); const s = state.snapshot; if (s?.currentWar && s.currentWar.state !== 'notInWar') add(s.currentWar, 'regular'); for (const w of s?.cwlWars || []) add(w, 'cwl'); let wars = [...map.values()]; if (kind !== 'all') wars = wars.filter(w => w.kind === kind); return wars.sort((a, b) => (warDate(b)?.getTime() || 0) - (warDate(a)?.getTime() || 0)) }
function bounds(now = new Date()) {
    const type = document.getElementById('timeRange').value;

    let start = null;
    let end = dayKey(now);

    const rangeDays = {
        '7d': 7,
        '30d': 30,
        '90d': 90
    };

    if (rangeDays[type]) {
        const first = new Date(now);

        first.setUTCDate(
            first.getUTCDate() - rangeDays[type] + 1
        );

        start = dayKey(first);
    } else if (type === 'ytd') {
        start = `${now.getUTCFullYear()}-01-01`;
    } else if (type === 'custom') {
        start = document.getElementById('dateFrom').value || null;
        end = document.getElementById('dateTo').value || end;
    }

    return { start, end, type };
} function withinRange(dateValue, range = bounds()) { const date = dateValue instanceof Date ? dateValue : gameDate(dateValue); if (!date) return false; const key = dayKey(date); return (!range.start || key >= range.start) && (!range.end || key <= range.end) }
function filteredWars(kind = 'all') { return allWars(kind).filter(w => withinRange(warDate(w))) }
function donationSummary() { const range = bounds(), baseline = state.history.donationBaseline; const rows = new Map(); const add = (tag, name, donated, received) => { const row = rows.get(tag) || { tag, name, donated: 0, received: 0 }; row.name = name || row.name; row.donated += Number(donated || 0); row.received += Number(received || 0); rows.set(tag, row) }; let baseUsed = false; if (baseline) { const baseDay = dayKey(baseline.at); const longRange = ['ytd', 'all'].includes(range.type) || (range.type === 'custom' && (!range.start || range.start <= baseDay)); if (longRange && withinRange(baseDay, range)) { for (const p of baseline.players || []) add(p.tag, p.name, p.donated, p.received); baseUsed = true } } for (const entry of state.history.donationDeltas || []) { if (withinRange(entry.date, range)) add(entry.tag, entry.name, entry.donated, entry.received) } if (!baseline && state.snapshot?.clan?.memberList) { for (const m of state.snapshot.clan.memberList) add(m.tag, m.name, m.donations, m.donationsReceived) } const list = [...rows.values()]; return { list, donated: list.reduce((n, p) => n + p.donated, 0), received: list.reduce((n, p) => n + p.received, 0), baseUsed, baseline } }
function statsForWars(wars) { const map = new Map(); let stars = 0, attacks = 0; for (const w of wars) { stars += Number(w.mine?.stars || 0); for (const member of w.mine?.members || []) { const row = map.get(member.tag) || { tag: member.tag, name: member.name, stars: 0, attacks: 0 }; for (const attack of member.attacks || []) { row.stars += Number(attack.stars || 0); row.attacks++ } map.set(member.tag, row) } } for (const row of map.values()) attacks += row.attacks; return { map, stars, attacks, warCount: wars.length, available: wars.length > 0, individualAvailable: wars.some(w => (w.mine?.members || []).length > 0) } }
function renderDonationAnalytics() {
    const range = bounds(); const summary = donationSummary(); const baseDate = summary.baseline?.at ? new Date(summary.baseline.at).toLocaleDateString(undefined, { timeZone: 'UTC' }) : 'not started'; document.getElementById('rangeDonated').textContent = `${number(summary.donated)} donated`; document.getElementById('rangeReceived').textContent = number(summary.received); document.getElementById('rangeDays').textContent = state.history.trackingStartedAt ? `${Math.max(1, Math.ceil((Date.now() - new Date(state.history.trackingStartedAt).getTime()) / 86400000))}` : '0'; document.getElementById('rangeStartLabel').textContent = baseDate; document.getElementById('donationHistoryNote').textContent = summary.baseUsed ? `Starting API balance included; tracking began ${new Date(state.history.trackingStartedAt || summary.baseline.at).toLocaleDateString(undefined, { timeZone: 'UTC' }) }. Older calendar-year totals are not in the API.` : `Donation changes tracked since ${state.history.trackingStartedAt ? new Date(state.history.trackingStartedAt).toLocaleDateString(undefined, { timeZone: 'UTC' }) : 'the first server refresh'}.`;
    document.getElementById('statDonated').textContent = number(summary.donated); document.getElementById('statDonatedSub').textContent = summary.baseUsed ? 'Selected range · starting API balance included' : 'Changes observed during selected range';
    const ranked = summary.list.sort((a, b) => b.donated - a.donated || a.name.localeCompare(b.name)).slice(0, 8); document.getElementById('donationRankRows').innerHTML = ranked.length ? ranked.map((p, i) => `<tr><td><div class="player"><span class="rank">${String(i + 1).padStart(2, '0')}</span>${escapeHtml(p.name)}</div></td><td class="num">${number(p.donated)}</td><td class="num">${number(p.received)}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-cell">No donation totals in this range yet.</td></tr>';
    const delta = (state.history.donationDeltas || []).filter(e => withinRange(e.date, range)); if (summary.baseUsed && summary.baseline) { for (const p of summary.baseline.players || []) delta.push({ date: dayKey(summary.baseline.at), donated: p.donated || 0, received: p.received || 0, baseline: true }) } renderDonationChart(delta, range);
}
function renderDonationChart(entries, range) {
    const el = document.getElementById('donationChart');

    if (!entries.length) {
        el.innerHTML = `
            <div class="empty">
                No donation changes recorded in this range yet.
                The server collects changes automatically;
                individual troop history is not provided by the game API.
            </div>
        `;
        return;
    }

    const now = new Date();
    const end = new Date(range.end || dayKey(now));

    let start = new Date(
        range.start ||
        dayKey(state.history.trackingStartedAt || now)
    );

    const utcDate = (year, month, day) =>
        new Date(Date.UTC(year, month, day));

    const days = Math.max(
        1,
        Math.ceil((end - start) / 86400000) + 1
    );

    let mode = 'day';
    let count = days;

    if (range.type === '7d') {
        count = 7;
    } else if (range.type === '30d') {
        count = 30;
    } else if (range.type === '90d') {
        mode = 'week';
        count = 13;
    } else if (range.type === 'ytd') {
        mode = 'month';
        start = utcDate(now.getUTCFullYear(), 0, 1);
        count = now.getUTCMonth() + 1;
    } else if (range.type === 'all') {
        mode = 'month';

        count = Math.min(
            24,
            Math.max(
                1,
                (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
                now.getUTCMonth() - start.getUTCMonth() + 1
            )
        );

        start = utcDate(
            now.getUTCFullYear(),
            now.getUTCMonth() - count + 1,
            1
        );
    } else if (range.type === 'custom' && days > 31) {
        if (days <= 180) {
            mode = 'week';
            count = Math.ceil(days / 7);
        } else {
            mode = 'month';

            count = Math.max(
                1,
                (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
                end.getUTCMonth() - start.getUTCMonth() + 1
            );
        }
    }

    count = Math.min(31, count);

    const buckets = [];

    if (mode === 'day') {
        for (let i = count - 1; i >= 0; i--) {
            const d = utcDate(
                end.getUTCFullYear(),
                end.getUTCMonth(),
                end.getUTCDate() - i
            );

            buckets.push({
                start: dayKey(d),
                end: dayKey(d),
                label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
                donated: 0
            });
        }
    } else if (mode === 'week') {
        for (let i = count - 1; i >= 0; i--) {
            const bucketEnd = utcDate(
                end.getUTCFullYear(),
                end.getUTCMonth(),
                end.getUTCDate() - i * 7
            );

            const bucketStart = new Date(bucketEnd);

            bucketStart.setUTCDate(
                bucketEnd.getUTCDate() - 6
            );

            buckets.push({
                start: dayKey(bucketStart),
                end: dayKey(bucketEnd),
                label: `${bucketStart.getUTCMonth() + 1}/${bucketStart.getUTCDate()}`,
                donated: 0
            });
        }
    } else {
        for (let i = 0; i < count; i++) {
            const d = utcDate(
                start.getUTCFullYear(),
                start.getUTCMonth() + i,
                1
            );

            const next = utcDate(
                d.getUTCFullYear(),
                d.getUTCMonth() + 1,
                0
            );

            buckets.push({
                start: dayKey(d),
                end: dayKey(next),
                label: d.toLocaleString(undefined, {
                    timeZone: 'UTC',
                    month: 'short',
                    year: count > 12 ? '2-digit' : undefined
                }),
                donated: 0
            });
        }
    }

    for (const entry of entries) {
        const bucket = buckets.find(
            b => entry.date >= b.start && entry.date <= b.end
        );

        if (bucket) {
            bucket.donated += Number(entry.donated || 0);
        }
    }

    const max = Math.max(
        1,
        ...buckets.map(b => b.donated)
    );

    el.innerHTML = buckets.map(b => `
        <div class="chart-day"
             title="${b.label}: ${number(b.donated)} donated">

            <div class="chart-bar"
                 style="height:${Math.max(2, b.donated / max * 94)}px">
            </div>

            <small>${escapeHtml(b.label)}</small>
        </div>
    `).join('');
} function renderProfile() { const c = state.snapshot?.clan; if (!c) return; document.getElementById('clanName').textContent = c.name; document.getElementById('clanTag').textContent = c.tag; document.getElementById('statMembers').textContent = number(c.members); document.getElementById('statMembersSub').textContent = `Level ${c.clanLevel || '—'} · ${c.type || 'Clan'}`; document.getElementById('profileLevel').textContent = number(c.clanLevel); document.getElementById('profileWins').textContent = number(c.warWins); document.getElementById('profileLeague').textContent = c.warLeague?.name || '—'; document.getElementById('profileNote').textContent = c.isWarLogPublic ? 'War log is public to the official API.' : 'War Log is private. Recent member attacks require it to be public.'; const badge = c.badgeUrls?.medium || c.badgeUrls?.small; if (badge) { for (const id of ['brandBadge', 'clanBadge']) { const img = document.getElementById(id); img.src = badge; img.hidden = false } } }
function renderMembers() { const members = state.snapshot?.clan?.memberList || []; const query = document.getElementById('memberSearch').value.trim().toLowerCase(); const filtered = members.filter(m => m.name.toLowerCase().includes(query)); const metrics = statsForWars(filteredWars()); const last = allWars('regular')[0]; const donations = new Map(donationSummary().list.map(p => [p.tag, p])); const lastParticipants = new Set((last?.mine?.members || []).filter(m => (m.attacks || []).length > 0).map(m => m.tag)); const roles = { leader: 'Leader', coLeader: 'Co-leader', admin: 'Elder', member: 'Member' }; document.getElementById('memberCount').textContent = `${members.length} clan members`; document.getElementById('shownCount').textContent = `${filtered.length} shown`; document.getElementById('membersCaption').textContent = `${members.length} members · live roster · green rows attacked in the most recent regular war`; document.getElementById('memberRows').innerHTML = filtered.length ? filtered.map(m => { const p = metrics.map.get(m.tag) || { stars: 0, attacks: 0 }; return `<tr class="${lastParticipants.has(m.tag) ? 'participated' : ''}"><td><div class="player"><span class="player-icon">${escapeHtml(m.townHallLevel || '•')}</span>${playerProfileButton(m)}</div></td><td><span class="role">${roles[m.role] || escapeHtml(m.role || 'Member')}</span></td><td class="num">${m.townHallLevel ?? '—'}</td><td class="num">${number(donations.get(m.tag)?.donated)}</td><td class="num">${number(donations.get(m.tag)?.received)}</td><td class="num ${metrics.individualAvailable ? 'accent' : 'muted'}">${metrics.individualAvailable ? number(p.stars) : '—'}</td><td class="num ${metrics.individualAvailable ? '' : 'muted'}">${metrics.individualAvailable ? number(p.attacks) : '—'}</td></tr>` }).join('') : `<tr><td colspan="7" class="empty-cell">${members.length ? 'No members match your search.' : 'Roster unavailable.'}</td></tr>`; renderLeaderboard() }
function renderLeaderboard() { const key = document.getElementById('leaderMetric').value; const rangeWars = filteredWars(); const warStats = statsForWars(rangeWars); const donations = donationSummary().list; const donationMap = new Map(donations.map(p => [p.tag, p])); const members = state.snapshot?.clan?.memberList || []; const metric = { donated: ['Top donors', 'DONATION HISTORY IN SELECTED RANGE'], stars: ['Most stars', 'WAR HISTORY IN SELECTED RANGE'], attacks: ['Most attacks', 'WAR HISTORY IN SELECTED RANGE'] }; document.getElementById('leaderTitle').textContent = metric[key][0]; document.getElementById('leaderNote').textContent = metric[key][1]; const value = m => key === 'donated' ? donationMap.get(m.tag)?.donated || 0 : warStats.map.get(m.tag)?.[key] || 0; const sorted = [...members].sort((a, b) => value(b) - value(a) || a.name.localeCompare(b.name)).slice(0, 8); document.getElementById('leaderRows').innerHTML = sorted.length ? sorted.map((m, i) => { const w = warStats.map.get(m.tag) || { stars: 0, attacks: 0 }; return `<tr class="${w.attacks ? 'participated' : ''}"><td class="rank">${String(i + 1).padStart(2, '0')}</td><td><div class="player"><span class="player-icon">${escapeHtml(m.townHallLevel || '•')}</span>${playerProfileButton(m)}</div></td><td class="num ${warStats.individualAvailable ? 'accent' : 'muted'}">${warStats.individualAvailable ? number(w.stars) : '—'}</td><td class="num ${warStats.individualAvailable ? '' : 'muted'}">${warStats.individualAvailable ? number(w.attacks) : '—'}</td><td class="num">${number(donationMap.get(m.tag)?.donated || 0)}</td></tr>` }).join('') : '<tr><td colspan="5" class="empty-cell">No members available.</td></tr>' }
function renderWar() { const wars = allWars('regular'); const current = state.snapshot?.currentWar; const currentSide = current && sideFor(current); const active = current && ['inWar', 'inPreparation'].includes(current.state) ? { ...current, ...currentSide } : null; const selected = active || wars[0]; const stats = statsForWars(filteredWars()); document.getElementById('statStars').textContent = stats.available ? number(stats.stars) : '—'; document.getElementById('statAttacks').textContent = stats.individualAvailable ? number(stats.attacks) : '—'; document.getElementById('statStarsSub').textContent = stats.available ? `${stats.warCount} war records in selected range` : 'War Log is private or no war details are available'; document.getElementById('statAttacksSub').textContent = stats.individualAvailable ? 'Across recorded wars in selected range' : 'Individual attack details are unavailable'; const pill = document.getElementById('warState'), body = document.getElementById('warBody'); if (!selected) { document.getElementById('warTitle').textContent = 'Most recent clan war'; document.getElementById('warMeta').textContent = 'No regular war results are available'; pill.textContent = 'NO DATA'; body.innerHTML = `<div class="empty"><strong>No regular war data is available yet</strong>${state.snapshot?.clan?.isWarLogPublic ? 'The tracker will save attack details during the next war.' : 'Make the clan War Log public so the API can return war data. The tracker will capture member attacks while future wars are active.'}</div>`; return } const used = (selected.mine?.members || []).reduce((n, m) => n + (m.attacks || []).length, 0); const total = (selected.teamSize || 0) * 2; document.getElementById('warTitle').textContent = active ? 'Current regular war' : 'Most recent regular war'; document.getElementById('warMeta').textContent = `${selected.mine.name} vs ${selected.other?.name || 'Opponent'} · ${selected.teamSize || 0} vs ${selected.teamSize || 0} · ${gameDate(selected.endTime || selected.startTime)?.toLocaleDateString(undefined, { timeZone: 'UTC' }) || 'date unavailable'}`; pill.textContent = active ? 'LIVE' : String(selected.state || 'WAR ENDED').toUpperCase(); body.innerHTML = `<div class="score"><div class="clanscore"><strong>${number(selected.mine.stars)}</strong><span>${escapeHtml(selected.mine.name)}</span></div><div class="versus">VS</div><div class="clanscore"><strong>${number(selected.other?.stars)}</strong><span>${escapeHtml(selected.other?.name || 'Opponent')}</span></div></div><div class="progress-wrap"><div class="progress-label"><span>Clan attacks used</span><span>${used} / ${total || '—'}</span></div><div class="progress"><i style="width:${total ? Math.min(100, used / total * 100) : 0}%"></i></div></div><div class="war-bottom"><span><b>${number(selected.mine.stars)} stars</b> · ${Number(selected.mine.destructionPercentage || 0).toFixed(1)}% destruction</span><span>${used} attacks recorded</span></div>`; renderLastWar(wars[0]) }
function renderLastWar(war) { const host = document.getElementById('lastWarBody'); const dateEl = document.getElementById('lastWarDate'); if (!war) { document.getElementById('lastWarCaption').textContent = 'Participation is saved while a war is active.'; dateEl.textContent = ''; host.innerHTML = `<div class="empty"><strong>No participant record is available yet</strong>${state.snapshot?.clan?.isWarLogPublic ? 'The tracker will capture players and attacks from the next active regular war.' : 'The clan War Log is private. Make it public, then this tracker can capture attacks from future wars. Previously completed member attack lists cannot be recovered from the official API.'}</div>`; return } dateEl.textContent = gameDate(war.endTime || war.startTime)?.toLocaleDateString(undefined, { timeZone: 'UTC' }) || ''; const members = war.mine?.members || []; const participants = members.filter(m => (m.attacks || []).length > 0); document.getElementById('lastWarCaption').textContent = `${escapeHtml(war.mine.name)} vs ${escapeHtml(war.other?.name || 'Opponent')} · ${participants.length} participated / ${members.length} rostered`; if (!members.length) { host.innerHTML = '<div class="empty"><strong>War result is available, but its member attack list is not</strong>The official war log contains clan scores, not individual attackers. The tracker will store the member roster while it can see a future active war.</div>'; return } host.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Member</th><th>Participation</th><th class="num">Attacks</th><th class="num">Stars</th><th class="num">Destruction</th></tr></thead><tbody>${[...members].sort((a, b) => (b.attacks || []).length - (a.attacks || []).length || a.name.localeCompare(b.name)).map(m => { const attacks = m.attacks || [], stars = attacks.reduce((n, a) => n + Number(a.stars || 0), 0), damage = attacks.reduce((n, a) => n + Number(a.destructionPercentage || 0), 0); return `<tr class="${attacks.length ? 'participated' : ''}"><td>${escapeHtml(m.name)}</td><td>${attacks.length ? 'Participated' : 'No attacks'}</td><td class="num">${attacks.length}</td><td class="num">${stars}</td><td class="num">${damage.toFixed(1)}%</td></tr>` }).join('')}</tbody></table></div>` }
function standings(wars) { const map = new Map(); for (const w of wars) { if (w.state !== 'warEnded') continue; for (const side of [w.clan, w.opponent]) { if (!side?.tag) continue; const id = side.tag.toUpperCase(), row = map.get(id) || { tag: id, name: side.name, stars: 0, destruction: 0, wins: 0, losses: 0, ties: 0 }; row.stars += Number(side.stars || 0); row.destruction += Number(side.destructionPercentage || 0); const mine = (w.clan.tag || '').toUpperCase() === id ? w.clan : w.opponent, other = mine === w.clan ? w.opponent : w.clan; if (mine.stars > other.stars || (mine.stars === other.stars && mine.destructionPercentage > other.destructionPercentage)) row.wins++; else if (mine.stars < other.stars || (mine.stars === other.stars && mine.destructionPercentage < other.destructionPercentage)) row.losses++; else row.ties++; map.set(id, row) } } return [...map.values()].sort((a, b) => b.stars - a.stars || b.destruction - a.destruction) }
function renderCwl() { const group = state.snapshot?.leagueGroup, wars = state.snapshot?.cwlWars || [], body = document.getElementById('cwlBody'); document.getElementById('leagueBadge').textContent = (state.snapshot?.clan?.warLeague?.name || 'CWL').toUpperCase(); if (!group) { document.getElementById('cwlSub').textContent = 'No active group; archived CWL rounds are listed below.'; body.innerHTML = `<div class="empty"><strong>No active CWL group returned</strong>${escapeHtml(state.snapshot?.leagueError || 'The official API only provides the current league group. Past groups are retained here when the tracker observed them.')}</div>` } else { document.getElementById('cwlSub').textContent = `Season ${group.season || 'current'} · ${wars.length} round war records loaded`; const table = standings(wars), rank = table.findIndex(x => x.tag === tag()); const me = table[rank]; body.innerHTML = table.length ? `<div class="cwl-metrics"><div class="cwl-metric"><strong>${rank >= 0 ? '#' + (rank + 1) : '—'}</strong><span>Group standing</span></div><div class="cwl-metric"><strong>${number(me?.stars)}</strong><span>Stars</span></div><div class="cwl-metric"><strong>${me ? `${me.wins}–${me.losses}–${me.ties}` : '—'}</strong><span>W–L–T</span></div></div><div class="table-wrap" style="margin-top:14px"><table class="table"><thead><tr><th>Rank</th><th>Clan</th><th class="num">Stars</th><th class="num">Destruction</th><th class="num">W–L–T</th></tr></thead><tbody>${table.map((c, i) => `<tr class="${c.tag === tag() ? 'participated' : ''}"><td class="rank">${String(i + 1).padStart(2, '0')}</td><td>${escapeHtml(c.name)}${c.tag === tag() ? ' <b>(you)</b>' : ''}</td><td class="num">${number(c.stars)}</td><td class="num">${c.destruction.toFixed(1)}%</td><td class="num">${c.wins}–${c.losses}–${c.ties}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">CWL group is open. Results will populate after league wars finish.</div>' } renderCwlHistory() }
function renderCwlHistory() { const wars = allWars('cwl').filter(w => withinRange(warDate(w))); const seasons = new Map(); for (const w of wars) { const season = w.season || 'Unknown season'; const row = seasons.get(season) || { season, wars: 0, wins: 0, losses: 0, ties: 0, stars: 0, attacks: 0 }; row.wars++; row.stars += Number(w.mine?.stars || 0); row.attacks += (w.mine?.members || []).reduce((n, m) => n + (m.attacks || []).length, 0); if (w.state === 'warEnded') { const mine = w.mine, other = w.other; if (mine.stars > other.stars || (mine.stars === other.stars && mine.destructionPercentage > other.destructionPercentage)) row.wins++; else if (mine.stars < other.stars || (mine.stars === other.stars && mine.destructionPercentage < other.destructionPercentage)) row.losses++; else row.ties++ } seasons.set(season, row) } const rows = [...seasons.values()].sort((a, b) => b.season.localeCompare(a.season)); document.getElementById('cwlHistoryNote').textContent = `${wars.length} archived CWL wars · selected range`; document.getElementById('cwlHistoryRows').innerHTML = rows.length ? rows.map(s => `<tr><td>${escapeHtml(s.season)}</td><td class="num">${s.wars}</td><td class="num">${s.wins}–${s.losses}–${s.ties}</td><td class="num">${s.stars}</td><td class="num">${s.attacks || '—'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">No CWL group was archived during the selected period. The official API only exposes the active group; this tracker keeps rounds it observes going forward.</td></tr>' }
function renderActivity() { const kind = document.getElementById('warType')?.value || 'all'; const wars = filteredWars(kind); document.getElementById('warActivityTag').textContent = `${wars.length} RECORD${wars.length === 1 ? '' : 'S'} ? SELECTED RANGE`; const host = document.getElementById('warActivity'); host.innerHTML = wars.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Type</th><th>Opponent</th><th>Result</th><th class="num">Stars</th><th class="num">Attacks</th></tr></thead><tbody>${wars.map(w => { const attacks = (w.mine?.members || []).reduce((n, m) => n + (m.attacks || []).length, 0); const ended = w.state === 'warEnded' || w.source === 'warLog'; let result = 'In progress'; if (ended) { if (w.mine.stars > w.other.stars) result = 'Win'; else if (w.mine.stars < w.other.stars) result = 'Loss'; else if (Number(w.mine.destructionPercentage || 0) > Number(w.other.destructionPercentage || 0)) result = 'Win'; else if (Number(w.mine.destructionPercentage || 0) < Number(w.other.destructionPercentage || 0)) result = 'Loss'; else result = 'Tie' } return `<tr><td>${warDate(w)?.toLocaleDateString(undefined, { timeZone: 'UTC' }) || '?'}</td><td>${w.kind === 'cwl' ? 'CWL' : 'Regular'}</td><td>${escapeHtml(w.other?.name || 'Opponent')}</td><td>${result}</td><td class="num">${number(w.mine?.stars)}</td><td class="num">${w.mine?.members ? attacks : '?'}</td></tr>` }).join('')}</tbody></table></div>` : `<div class="empty"><strong>No war records in this range</strong>${state.snapshot?.clan?.isWarLogPublic ? 'The tracker will add regular wars from the public war log and capture member attacks while a war is active.' : 'Make the clan War Log public for regular war history. CWL rounds will be archived when an active group is available.'}</div>` }
function renderAll() {
    renderProfile();
    renderDonationAnalytics();
    renderWar();
    renderMembers();
    renderCwl();
    renderActivity();

    updateExportControls();

    if (document.getElementById('playerProfileDialog').open) {
        renderPlayerProfile();
    }
}
function applySnapshot(data) { state.snapshot = data; state.history = data.history || {}; const status = document.getElementById('apiStatus'); status.textContent = data.lastError ? 'Cached data · API refresh retrying' : 'Live clan data'; status.className = data.lastError ? 'status bad' : 'status'; document.getElementById('refreshStamp').textContent = `Last server refresh ${data.updatedAt ? new Date(data.updatedAt).toLocaleString() : 'unknown'} · Dashboard checks every minute`; document.getElementById('footerNote').textContent = `Clash Ledger · ${data.clan.name} · ${data.clan.tag}`; renderAll() }
async function refreshClan() { try { const response = await fetch('/api/clan', { cache: 'no-store' }), data = await response.json(); if (!response.ok) throw new Error(data.error || 'Clan API unavailable'); applySnapshot(data) } catch (error) { const status = document.getElementById('apiStatus'); status.textContent = `Connection failed: ${error.message}`; status.className = 'status bad'; document.getElementById('refreshStamp').textContent = 'Open this page on the same computer as the running server.' } }
function refreshRange() { const custom = document.getElementById('timeRange').value === 'custom'; document.getElementById('customDates').hidden = !custom; renderAll() }
let selectedPlayerTag = null;

function playerProfileButton(member) {
    return `<button type="button"
        class="player-profile-link"
        data-player-tag="${escapeHtml(member.tag)}"
        aria-haspopup="dialog">
        ${escapeHtml(member.name)}
    </button>`;
}

function getPlayerProfile(playerTag) {
    const members = state.snapshot?.clan?.memberList || [];

    const member = members.find(m => m.tag === playerTag);

    if (!member) return null;

    const range = bounds();
    const summary = donationSummary();

    const totals = summary.list.find(
        p => p.tag === playerTag
    );

    const baselineIncluded = summary.baseUsed &&
        (summary.baseline.players || []).some(
            p => p.tag === playerTag
        );

    const daily = new Map();

    for (const entry of state.history.donationDeltas || []) {
        if (entry.tag !== playerTag ||
            !withinRange(entry.date, range)) {
            continue;
        }

        const date = dayKey(entry.date);

        const row = daily.get(date) || {
            date,
            donated: 0,
            received: 0
        };

        row.donated += Number(entry.donated || 0);
        row.received += Number(entry.received || 0);

        daily.set(date, row);
    }

    const wars = [];

    for (const war of filteredWars()) {
        const player = (war.mine?.members || []).find(
            m => m.tag === playerTag
        );

        if (!player) continue;

        const attacks = player.attacks || [];

        wars.push({
            date: dayKey(warDate(war)),
            opponent: war.other?.name || 'Unknown opponent',
            type: war.kind === 'cwl' ? 'CWL' : 'Regular',
            attacks: attacks.length,
            stars: attacks.reduce(
                (sum, a) => sum + Number(a.stars || 0), 0
            )
        });
    }

    return {
        member,
        range,
        donated: totals?.donated || 0,
        received: totals?.received || 0,
        baselineIncluded,
        liveOnly: !summary.baseline,
        daily: [...daily.values()].sort(
            (a, b) => b.date.localeCompare(a.date)
        ),
        wars,
        stars: wars.reduce((sum, w) => sum + w.stars, 0),
        attacks: wars.reduce((sum, w) => sum + w.attacks, 0)
    };
}

function renderPlayerProfile() {
    const dialog = document.getElementById('playerProfileDialog');
    const profile = getPlayerProfile(selectedPlayerTag);

    if (!profile) {
        if (dialog.open) dialog.close();
        return false;
    }

    const m = profile.member;

    const roles = {
        leader: 'Leader',
        coLeader: 'Co-leader',
        admin: 'Elder',
        member: 'Member'
    };

    document.getElementById('playerProfileTitle').textContent =
        m.name;

    document.getElementById('playerProfileMeta').textContent =
        `${m.tag} · Town Hall ${m.townHallLevel ?? '—'} · ${roles[m.role] || m.role || 'Member'
        }`;

    const metrics = [
        ['Donated', number(profile.donated)],
        ['Received', number(profile.received)],
        ['War stars', profile.wars.length ? number(profile.stars) : '—'],
        ['Attacks', profile.wars.length ? number(profile.attacks) : '—']
    ];

    const donationNote = profile.liveOnly
        ? 'Current API totals; historical baseline is unavailable.'
        : profile.baselineIncluded
            ? 'Totals include the starting API balance; daily rows show only recorded changes.'
            : 'Totals and daily rows show recorded changes in the selected range.';

    const donationRows = profile.daily.map(row => `
        <tr>
            <td>${escapeHtml(row.date)}</td>
            <td class="num">${number(row.donated)}</td>
            <td class="num">${number(row.received)}</td>
        </tr>
    `).join('');

    const warRows = profile.wars.map(war => `
        <tr>
            <td>${escapeHtml(war.date)}</td>
            <td>${escapeHtml(war.opponent)}</td>
            <td>${escapeHtml(war.type)}</td>
            <td class="num">${number(war.attacks)}</td>
            <td class="num">${number(war.stars)}</td>
        </tr>
    `).join('');

    document.getElementById('playerProfileContent').innerHTML = `
        <p class="profile-note">
            ${escapeHtml(profile.range.start || 'All earlier dates')}
            to ${escapeHtml(profile.range.end)} (UTC)
        </p>

        <div class="player-profile-stats">
            ${metrics.map(([label, value]) => `
                <div>
                    <strong>${value}</strong>
                    <span>${label}</span>
                </div>
            `).join('')}
        </div>

        <p class="profile-note">${donationNote}</p>

        <h3>Donation history</h3>

        <div class="table-wrap">
            <table class="table">
                <thead>
                    <tr>
                        <th>Date (UTC)</th>
                        <th class="num">Donated</th>
                        <th class="num">Received</th>
                    </tr>
                </thead>
                <tbody>
                    ${donationRows || `
                        <tr>
                            <td colspan="3" class="empty-cell">
                                No recorded donation changes.
                            </td>
                        </tr>
                    `}
                </tbody>
            </table>
        </div>

        <h3>War history</h3>

        <p class="profile-note">
            Only wars with saved player details are included.
        </p>

        <div class="table-wrap">
            <table class="table">
                <thead>
                    <tr>
                        <th>Date (UTC)</th>
                        <th>Opponent</th>
                        <th>Type</th>
                        <th class="num">Attacks</th>
                        <th class="num">Stars</th>
                    </tr>
                </thead>
                <tbody>
                    ${warRows || `
                        <tr>
                            <td colspan="5" class="empty-cell">
                                No recorded player war details.
                            </td>
                        </tr>
                    `}
                </tbody>
            </table>
        </div>
    `;

    return true;
}

function openPlayerProfile(playerTag) {
    selectedPlayerTag = playerTag;

    if (renderPlayerProfile()) {
        const dialog = document.getElementById('playerProfileDialog');

        if (!dialog.open) {
            dialog.showModal();
        }
    }
}

for (const id of ['memberRows', 'leaderRows']) {
    document.getElementById(id).addEventListener('click', event => {
        const button = event.target.closest('button[data-player-tag]');

        if (button) {
            openPlayerProfile(button.dataset.playerTag);
        }
    });
}
function csvCell(value) {
    let text = String(value ?? '');

    // Prevent spreadsheet formula injection.
    if (typeof value === 'string' &&
        (/^[\s\uFEFF]*[=+\-@＝＋－＠]/.test(text) ||
            /^[\t\r\n]/.test(text))) {
        text = "'" + text;
    }

    return '"' + text.replace(/"/g, '""') + '"';
}

function toCsv(rows) {
    return rows
        .map(row => row.map(csvCell).join(','))
        .join('\r\n') + '\r\n';
}

function donationExportSource(summary, tag) {
    if (!summary.baseline) {
        return 'Current API totals (not date-filtered)';
    }

    if (summary.baseUsed &&
        (summary.baseline.players || []).some(p => p.tag === tag)) {
        return 'Starting API balance + recorded changes';
    }

    return 'Recorded changes';
}

function exportWarResult(war) {
    if (war.state !== 'warEnded' &&
        war.source !== 'warLog') {
        return 'In progress';
    }

    const mine = war.mine;
    const other = war.other;

    if (mine?.stars == null || other?.stars == null) {
        return '';
    }

    if (mine.stars > other.stars) return 'Win';
    if (mine.stars < other.stars) return 'Loss';

    if (mine.destructionPercentage == null ||
        other.destructionPercentage == null) {
        return '';
    }

    if (mine.destructionPercentage > other.destructionPercentage) {
        return 'Win';
    }

    if (mine.destructionPercentage < other.destructionPercentage) {
        return 'Loss';
    }

    return 'Tie';
}

function buildCsvRows(kind) {
    const range = bounds();

    const dates = [
        range.start || '',
        range.end || ''
    ];

    const dateHeaders = [
        'Range start (UTC)',
        'Range end (UTC)'
    ];

    // Export current clan members.
    if (kind === 'members') {
        const members = state.snapshot?.clan?.memberList || [];
        const summary = donationSummary();

        const donations = new Map(
            summary.list.map(p => [p.tag, p])
        );

        const stats = statsForWars(filteredWars());

        const roles = {
            leader: 'Leader',
            coLeader: 'Co-leader',
            admin: 'Elder',
            member: 'Member'
        };

        return [
            [
                'Player tag',
                'Player',
                'Role',
                'Town Hall',
                'Donated',
                'Received',
                'Donation source',
                'War stars',
                'Attacks',
                ...dateHeaders
            ],

            ...members.map(m => {
                const donation = donations.get(m.tag);
                const war = stats.map.get(m.tag);

                return [
                    m.tag,
                    m.name,
                    roles[m.role] || m.role || 'Member',
                    m.townHallLevel ?? '',
                    donation?.donated ?? 0,
                    donation?.received ?? 0,
                    donationExportSource(summary, m.tag),
                    war?.stars ?? '',
                    war?.attacks ?? '',
                    ...dates
                ];
            })
        ];
    }

    // Export historical donation totals.
    if (kind === 'donations') {
        const summary = donationSummary();

        return [
            [
                'Player tag',
                'Player',
                'Donated',
                'Received',
                'Donation source',
                ...dateHeaders
            ],

            ...summary.list.map(p => [
                p.tag,
                p.name,
                p.donated,
                p.received,
                donationExportSource(summary, p.tag),
                ...dates
            ])
        ];
    }

    // Export regular war and CWL history.
    if (kind === 'wars') {
        const warType =
            document.getElementById('warType')?.value || 'all';

        return [
            [
                'Date (UTC)',
                'Type',
                'Opponent',
                'Opponent tag',
                'Result',
                'Clan stars',
                'Opponent stars',
                'Clan destruction (%)',
                'Opponent destruction (%)',
                'Recorded attacks',
                ...dateHeaders
            ],

            ...filteredWars(warType).map(w => {
                const members = w.mine?.members || [];

                const attacks = members.reduce(
                    (sum, m) => sum + (m.attacks || []).length,
                    0
                );

                return [
                    dayKey(warDate(w)),
                    w.kind === 'cwl' ? 'CWL' : 'Regular',
                    w.other?.name || '',
                    w.other?.tag || '',
                    exportWarResult(w),
                    w.mine?.stars ?? '',
                    w.other?.stars ?? '',
                    w.mine?.destructionPercentage ?? '',
                    w.other?.destructionPercentage ?? '',
                    members.length ? attacks : '',
                    ...dates
                ];
            })
        ];
    }

    return [];
}

function updateExportControls() {
    document.getElementById('exportCsv').disabled =
        !state.snapshot?.clan;
}

function downloadCsv() {
    const status = document.getElementById('exportStatus');
    const kind = document.getElementById('exportType').value;
    const range = bounds();

    if (!state.snapshot?.clan) {
        status.textContent = 'Wait for the clan data to load.';
        return;
    }

    if (range.start && range.end && range.start > range.end) {
        status.textContent = 'Choose a valid date range.';
        return;
    }

    const rows = buildCsvRows(kind);

    if (rows.length <= 1) {
        status.textContent = 'No data available for this export.';
        return;
    }

    // UTF-8 BOM improves compatibility with Excel.
    const blob = new Blob(
        ['\uFEFF', toCsv(rows)],
        { type: 'text/csv;charset=utf-8' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;

    link.download = 'clash-ledger-' + kind + '-' +
        (range.start || 'all') + '-to-' + range.end + '.csv';

    document.body.appendChild(link);

    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    status.textContent =
        'Exported ' + (rows.length - 1) + ' records.';
}

document.getElementById('exportCsv')
    .addEventListener('click', downloadCsv);

document.getElementById('memberSearch').addEventListener('input', renderMembers);
document.getElementById('leaderMetric').addEventListener('change', renderLeaderboard);
document.getElementById('timeRange').addEventListener('change', refreshRange);
document.getElementById('dateFrom').addEventListener('change', renderAll);
document.getElementById('dateTo').addEventListener('change', renderAll);
const warType = document.getElementById('warType');
if (warType) warType.addEventListener('change', renderActivity);
renderAll();
refreshClan();
setInterval(refreshClan, 60_000);