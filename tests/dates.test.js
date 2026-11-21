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
        }
    };

    document.getElementById('timeRange').value = 'custom';
    document.getElementById('leaderMetric').value = 'donated';
    document.getElementById('dateFrom').value = '2026-11-20';
    document.getElementById('dateTo').value = '2026-11-20';

    const context = vm.createContext({
        document,
        Date,
        fetch: () => new Promise(() => { }),
        setInterval() { }
    });

    vm.runInContext(source, context);

    return {
        document,
        run: code => vm.runInContext(code, context)
    };
}

for (const timezone of ['America/Chicago', 'Asia/Tokyo']) {
    test(`Donation dates remain accurate in ${timezone}`, () => {
        const original = process.env.TZ;

        process.env.TZ = timezone;

        try {
            const { document, run } = dashboard();

            assert.equal(
                run("dayKey('2026-11-20')"),
                '2026-11-20'
            );

            assert.equal(
                run("dayKey('2026-11-20T23:30:00Z')"),
                '2026-11-20'
            );

            assert.equal(
                run("withinRange('2026-11-20')"),
                true
            );

            assert.equal(
                run("withinRange('2026-11-21')"),
                false
            );

            run(`
                state.history = {
                    trackingStartedAt: '2026-11-20T00:30:00Z',

                    donationBaseline: {
                        at: '2026-11-20T00:30:00Z',
                        players: [
                            {
                                tag: '#P',
                                name: 'Player',
                                donated: 100
                            }
                        ]
                    },

                    donationDeltas: [
                        { date: '2026-11-19', tag: '#P', donated: 5 },
                        { date: '2026-11-20', tag: '#P', donated: 20 },
                        { date: '2026-11-21', tag: '#P', donated: 30 }
                    ]
                };

                renderDonationAnalytics();
            `);

            assert.equal(
                run('donationSummary().donated'),
                120
            );

            assert.match(
                document.getElementById('donationChart').innerHTML,
                /title="11\/20: 120 donated"/
            );

            document.getElementById('timeRange').value = 'ytd';

            assert.equal(
                run("bounds(new Date('2027-01-01T00:15:00Z')).start"),
                '2027-01-01'
            );

            document.getElementById('timeRange').value = '7d';

            assert.equal(
                run("bounds(new Date('2026-03-10T00:15:00Z')).start"),
                '2026-03-04'
            );
        } finally {
            if (original === undefined) {
                delete process.env.TZ;
            } else {
                process.env.TZ = original;
            }
        }
    });
}