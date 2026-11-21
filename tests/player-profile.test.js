const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '../app.js'), 'utf8'
);

function dashboard() {
    const elements = new Map();

    const document = {
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, {
                    value: '',
                    addEventListener() { },
                    showModal() { this.open = true; },
                    close() { this.open = false; }
                });
            }

            return elements.get(id);
        },

        querySelectorAll() {
            return [];
        }
    };

    document.getElementById('timeRange').value = 'custom';
    document.getElementById('leaderMetric').value = 'donated';
    document.getElementById('dateFrom').value = '2026-11-20';
    document.getElementById('dateTo').value = '2026-11-21';

    const context = vm.createContext({
        document,
        Date,
        fetch: () => new Promise(() => { }),
        setInterval() { }
    });

    vm.runInContext(source, context);

    const run = code => vm.runInContext(code, context);

    run(`
        state.snapshot = {
            clan: {
                tag: '#CLAN',
                memberList: [
                    {
                        tag: '#P1',
                        name: 'Player',
                        townHallLevel: 16
                    },
                    {
                        tag: '#P2',
                        name: 'Player',
                        townHallLevel: 15
                    }
                ]
            }
        };

        state.history = {
            donationBaseline: {
                at: '2026-11-20T00:30:00Z',
                players: [
                    { tag: '#P1', name: 'Player', donated: 100 }
                ]
            },

            donationDeltas: [
                { date: '2026-11-20', tag: '#P1', donated: 10, received: 2 },
                { date: '2026-11-20', tag: '#P1', donated: 5, received: 1 },
                { date: '2026-11-21', tag: '#P2', donated: 50 },
                { date: '2026-11-22', tag: '#P1', donated: 30 }
            ],

            wars: [{
                endTime: '2026-11-20T12:00:00Z',
                clan: {
                    tag: '#CLAN',
                    members: [
                        {
                            tag: '#P1',
                            attacks: [{ stars: 3 }, { stars: 2 }]
                        }
                    ]
                },
                opponent: {
                    tag: '#OPP',
                    name: '<Opponent>'
                }
            }]
        };
    `);

    return { document, run };
}

test('Profiles filter by player tag and selected dates', () => {
    const { run } = dashboard();

    assert.equal(run("getPlayerProfile('#P1').donated"), 115);
    assert.equal(run("getPlayerProfile('#P1').received"), 3);
    assert.equal(run("getPlayerProfile('#P1').daily.length"), 1);
    assert.equal(run("getPlayerProfile('#P1').daily[0].donated"), 15);
    assert.equal(run("getPlayerProfile('#P1').stars"), 5);
    assert.equal(run("getPlayerProfile('#P1').attacks"), 2);

    assert.equal(run("getPlayerProfile('#P2').donated"), 50);
    assert.equal(run("getPlayerProfile('#P2').wars.length"), 0);

    assert.equal(run("getPlayerProfile('#UNKNOWN')"), null);
});

test('Profile opens and safely displays saved history', () => {
    const { document, run } = dashboard();

    run('renderMembers()');

    assert.match(
        document.getElementById('memberRows').innerHTML,
        /data-player-tag="#P1"/
    );

    run("openPlayerProfile('#P1')");

    assert.equal(
        document.getElementById('playerProfileDialog').open,
        true
    );

    assert.equal(
        document.getElementById('playerProfileTitle').textContent,
        'Player'
    );

    assert.match(
        document.getElementById('playerProfileContent').innerHTML,
        /&lt;Opponent&gt;/
    );

    run("openPlayerProfile('#P2')");

    assert.match(
        document.getElementById('playerProfileContent').innerHTML,
        /No recorded player war details/
    );
});