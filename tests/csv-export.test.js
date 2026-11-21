const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '../app.js'),
    'utf8'
);

function dashboard() {
    const elements = new Map();
    const downloads = {};

    const document = {
        getElementById(id) {
            if (!elements.has(id)) {
                elements.set(id, {
                    value: '',
                    addEventListener() { }
                });
            }

            return elements.get(id);
        },

        querySelectorAll() {
            return [];
        },

        createElement() {
            return {
                click() {
                    downloads.filename = this.download;
                },

                remove() { }
            };
        },

        body: {
            appendChild() { }
        }
    };

    document.getElementById('timeRange').value = 'custom';
    document.getElementById('dateFrom').value = '2026-11-20';
    document.getElementById('dateTo').value = '2026-11-21';
    document.getElementById('leaderMetric').value = 'donated';
    document.getElementById('exportType').value = 'members';

    const context = vm.createContext({
        document,
        Date,
        Blob,

        URL: {
            createObjectURL(blob) {
                downloads.blob = blob;
                return 'blob:test';
            },

            revokeObjectURL() { }
        },

        fetch: () => new Promise(() => { }),

        setInterval() { },

        setTimeout(fn) {
            fn();
        }
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
                        role: 'admin',
                        townHallLevel: 16
                    },
                    {
                        tag: '#P2',
                        name: 'Player',
                        role: 'member',
                        townHallLevel: 15
                    }
                ]
            }
        };

        state.history = {
            donationBaseline: {
                at: '2026-11-20T00:30:00Z',

                players: [
                    {
                        tag: '#P1',
                        name: 'Player',
                        donated: 100
                    }
                ]
            },

            donationDeltas: [
                {
                    date: '2026-11-19',
                    tag: '#P1',
                    name: 'Player',
                    donated: 99
                },
                {
                    date: '2026-11-20',
                    tag: '#P1',
                    name: 'Player',
                    donated: 10
                },
                {
                    date: '2026-11-21',
                    tag: '#LEFT',
                    name: 'Former member',
                    donated: 30
                },
                {
                    date: '2026-11-22',
                    tag: '#P1',
                    name: 'Player',
                    donated: 99
                }
            ],

            wars: [
                {
                    state: 'warEnded',
                    endTime: '2026-11-20T12:00:00Z',

                    clan: {
                        tag: '#CLAN',
                        stars: 10,

                        members: [
                            {
                                tag: '#P1',
                                attacks: [{ stars: 3 }]
                            }
                        ]
                    },

                    opponent: {
                        tag: '#OPP',
                        name: 'Opponent',
                        stars: 8
                    }
                },
                {
                    source: 'warLog',
                    endTime: '2026-11-21T12:00:00Z',

                    clan: {
                        tag: '#CLAN',
                        stars: 5
                    },

                    opponent: {
                        tag: '#OPP2',
                        name: 'Other',
                        stars: 9
                    }
                },
                {
                    state: 'warEnded',
                    endTime: '2026-11-22T12:00:00Z',

                    clan: {
                        tag: '#CLAN',
                        stars: 12
                    },

                    opponent: {
                        tag: '#OPP3',
                        name: 'Outside range',
                        stars: 0
                    }
                }
            ]
        };
    `);

    return {
        document,
        run,
        downloads
    };
}

test('CSV escapes commas, quotes and spreadsheet formulas', () => {
    const { run } = dashboard();

    assert.equal(
        run('csvCell("A, B")'),
        '"A, B"'
    );

    assert.equal(
        run('csvCell(\'A "B"\')'),
        '"A ""B"""'
    );

    assert.equal(
        run('csvCell("=1+1")'),
        '"\'=1+1"'
    );

    assert.equal(
        run('csvCell("  @SUM(1,2)")'),
        '"\'  @SUM(1,2)"'
    );

    assert.equal(
        run('csvCell(-5)'),
        '"-5"'
    );

    assert.equal(
        run('csvCell("José")'),
        '"José"'
    );

    assert.equal(
        run('toCsv([["A", "B"], [1, 2]])'),
        '"A","B"\r\n"1","2"\r\n'
    );
});

test('Donation export respects the selected date range', () => {
    const { run } = dashboard();

    const rows = run("buildCsvRows('donations')");

    assert.equal(rows.length, 3);
    assert.equal(rows[1][0], '#P1');
    assert.equal(rows[1][2], 110);

    assert.match(
        rows[1][4],
        /Starting API balance/
    );

    assert.equal(rows[2][0], '#LEFT');
    assert.equal(rows[2][2], 30);
});

test('Member export keeps player tags and unavailable stats separate', () => {
    const { run } = dashboard();

    const rows = run("buildCsvRows('members')");

    assert.equal(rows.length, 3);

    assert.equal(rows[1][0], '#P1');
    assert.equal(rows[1][7], 3);
    assert.equal(rows[1][8], 1);

    assert.equal(rows[2][0], '#P2');
    assert.equal(rows[2][7], '');
    assert.equal(rows[2][8], '');
});

test('War export excludes outside dates and leaves missing attacks blank', () => {
    const { run } = dashboard();

    const rows = run("buildCsvRows('wars')");

    assert.equal(rows.length, 3);

    assert.equal(rows[1][4], 'Loss');
    assert.equal(rows[1][9], '');

    assert.equal(rows[2][4], 'Win');
    assert.equal(rows[2][9], 1);
});

test('Download creates a UTF-8 CSV file with the selected date range', async () => {
    const { run, document, downloads } = dashboard();

    run('downloadCsv()');

    assert.equal(
        downloads.filename,
        'clash-ledger-members-2026-11-20-to-2026-11-21.csv'
    );

    const bytes = Buffer.from(
        await downloads.blob.arrayBuffer()
    );

    assert.equal(
        bytes.subarray(0, 3).toString('hex'),
        'efbbbf'
    );

    assert.match(
        bytes.toString('utf8'),
        /"#P1","Player","Elder"/
    );

    assert.equal(
        document.getElementById('exportStatus').textContent,
        'Exported 2 records.'
    );
});