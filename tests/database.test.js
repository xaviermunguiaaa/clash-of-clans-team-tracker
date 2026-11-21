const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../database');

function fixture(t) {
    const dir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'clash-db-test-')
    );

    t.after(() => {
        fs.rmSync(dir, {
            recursive: true,
            force: true
        });
    });

    return dir;
}

const entry = {
    date: '2026-11-20',
    at: '2026-11-20T12:00:00Z',
    tag: '#PLAYER',
    name: 'Player',
    donated: 50,
    received: 10
};

test('New database starts with empty history', t => {
    const dir = fixture(t);
    const store = openStore(dir);

    try {
        const { history, snapshot } = store.load();

        assert.equal(snapshot, null);
        assert.deepEqual(history.donationDeltas, []);
        assert.deepEqual(history.wars, {});
    } finally {
        store.close();
    }
});

test('Imports legacy history once and persists new records', t => {
    const dir = fixture(t);

    const legacy = {
        trackingStartedAt: entry.at,

        donationBaseline: {
            at: entry.at,
            players: []
        },

        lastDonationTotals: {
            '#PLAYER': {
                donated: 50,
                received: 10
            }
        },

        donationDeltas: [entry],

        wars: {
            regular1: { state: 'inWar' }
        },

        cwlWars: {
            league1: { season: '2026-11' }
        },

        warLogBackfill: {
            cursor: 'abc',
            complete: false
        }
    };

    const snapshot = {
        clan: { name: 'Test Clan' },
        history: legacy
    };

    const historyFile = path.join(
        dir, 'tracker-history.json'
    );

    fs.writeFileSync(
        historyFile,
        JSON.stringify(legacy)
    );

    fs.writeFileSync(
        path.join(dir, 'clan-snapshot.json'),
        JSON.stringify(snapshot)
    );

    let store = openStore(dir);

    try {
        const loaded = store.load();

        assert.deepEqual(loaded.history, legacy);
        assert.deepEqual(loaded.snapshot, snapshot);

        loaded.history.donationDeltas.push({
            ...entry,
            donated: 25
        });

        loaded.history.wars.regular1.state = 'warEnded';

        store.save(loaded.history, {
            ...snapshot,
            updatedAt: '2026-11-21'
        });

    } finally {
        store.close();
    }

    store = openStore(dir);

    try {
        const loaded = store.load();

        assert.equal(
            loaded.history.donationDeltas.length, 2
        );

        assert.equal(
            loaded.history.donationDeltas[1].donated, 25
        );

        assert.equal(
            loaded.history.wars.regular1.state, 'warEnded'
        );

        assert.equal(
            loaded.history.cwlWars.league1.season, '2026-11'
        );

        assert.equal(
            loaded.snapshot.updatedAt, '2026-11-21'
        );

        assert.deepEqual(
            JSON.parse(fs.readFileSync(historyFile, 'utf8')),
            legacy
        );

    } finally {
        store.close();
    }
});

test('Failed write rolls back all inserted rows', t => {
    const dir = fixture(t);
    const store = openStore(dir);

    try {
        const { history } = store.load();

        history.donationDeltas.push(
            entry,
            { ...entry, tag: null }
        );

        assert.throws(() => {
            store.save(history, { clan: {} });
        });

        assert.deepEqual(
            store.load().history.donationDeltas, []
        );

        assert.equal(store.load().snapshot, null);

    } finally {
        store.close();
    }
});

test('Invalid legacy JSON is not silently replaced', t => {
    const dir = fixture(t);

    const file = path.join(
        dir, 'tracker-history.json'
    );

    fs.writeFileSync(file, 'invalid JSON');

    assert.throws(
        () => openStore(dir),
        /Cannot migrate/
    );

    assert.equal(
        fs.readFileSync(file, 'utf8'),
        'invalid JSON'
    );
});