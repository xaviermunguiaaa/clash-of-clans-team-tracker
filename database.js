const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function emptyHistory() {
    return {
        trackingStartedAt: null,
        donationBaseline: null,
        lastDonationTotals: {},
        donationDeltas: [],
        wars: {},
        cwlWars: {},
        warLogBackfill: {
            year: null,
            cursor: null,
            complete: false
        }
    };
}

function readLegacy(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Expected a JSON object');
        }

        return value;
    } catch (error) {
        if (error.code === 'ENOENT') return null;

        throw new Error(
            `Cannot migrate ${file}: ${error.message}`
        );
    }
}

function openStore(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });

    const db = new DatabaseSync(
        path.join(dataDir, 'clash-ledger.sqlite')
    );

    try {
        db.exec(`
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS tracker_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                metadata TEXT NOT NULL,
                snapshot TEXT
            );

            CREATE TABLE IF NOT EXISTS donation_deltas (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                player_tag TEXT NOT NULL,
                payload TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS donation_player_date
                ON donation_deltas (player_tag, date);

            CREATE TABLE IF NOT EXISTS wars (
                kind TEXT NOT NULL,
                war_key TEXT NOT NULL,
                payload TEXT NOT NULL,
                PRIMARY KEY (kind, war_key)
            );
        `);

        function save(history, snapshot) {
            const {
                donationDeltas,
                wars,
                cwlWars,
                ...metadata
            } = history;

            if (!Array.isArray(donationDeltas) ||
                !wars || typeof wars !== 'object' ||
                Array.isArray(wars) ||
                !cwlWars || typeof cwlWars !== 'object' ||
                Array.isArray(cwlWars)) {
                throw new Error('Invalid history structure');
            }

            db.exec('BEGIN IMMEDIATE');

            try {
                // Donation entries are append-only.
                const { lastId } = db.prepare(`
                    SELECT COALESCE(MAX(id), 0) AS lastId
                    FROM donation_deltas
                `).get();

                if (lastId > donationDeltas.length) {
                    throw new Error(
                        'Donation history cannot be shortened'
                    );
                }

                const insertDonation = db.prepare(`
                    INSERT INTO donation_deltas
                        (id, date, player_tag, payload)
                    VALUES (?, ?, ?, ?)
                `);

                for (let i = lastId; i < donationDeltas.length; i++) {
                    const entry = donationDeltas[i];

                    insertDonation.run(
                        i + 1,
                        entry.date,
                        entry.tag,
                        JSON.stringify(entry)
                    );
                }

                const upsertWar = db.prepare(`
                    INSERT INTO wars (kind, war_key, payload)
                    VALUES (?, ?, ?)

                    ON CONFLICT (kind, war_key)
                    DO UPDATE SET payload = excluded.payload
                `);

                for (const [kind, records] of [
                    ['regular', wars],
                    ['cwl', cwlWars]
                ]) {
                    for (const [key, war] of Object.entries(records)) {
                        upsertWar.run(
                            kind,
                            key,
                            JSON.stringify(war)
                        );
                    }
                }

                db.prepare(`
                    INSERT INTO tracker_state
                        (id, metadata, snapshot)
                    VALUES (1, ?, ?)

                    ON CONFLICT (id)
                    DO UPDATE SET
                        metadata = excluded.metadata,
                        snapshot = excluded.snapshot
                `).run(
                    JSON.stringify(metadata),
                    snapshot === null
                        ? null
                        : JSON.stringify(snapshot)
                );

                db.exec('COMMIT');

            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        }

        function load() {
            const row = db.prepare(`
                SELECT metadata, snapshot
                FROM tracker_state
                WHERE id = 1
            `).get();

            const history = {
                ...emptyHistory(),
                ...JSON.parse(row.metadata)
            };

            history.donationDeltas = db.prepare(`
                SELECT payload
                FROM donation_deltas
                ORDER BY id
            `).all().map(row => JSON.parse(row.payload));

            history.wars = Object.fromEntries(
                db.prepare(`
                    SELECT war_key, payload
                    FROM wars
                    WHERE kind = 'regular'
                    ORDER BY rowid
                `).all().map(row => [
                    row.war_key,
                    JSON.parse(row.payload)
                ])
            );

            history.cwlWars = Object.fromEntries(
                db.prepare(`
                    SELECT war_key, payload
                    FROM wars
                    WHERE kind = 'cwl'
                    ORDER BY rowid
                `).all().map(row => [
                    row.war_key,
                    JSON.parse(row.payload)
                ])
            );

            return {
                history,
                snapshot: row.snapshot === null
                    ? null
                    : JSON.parse(row.snapshot)
            };
        }

        // Import existing JSON data only once.
        if (!db.prepare(`
            SELECT id
            FROM tracker_state
            WHERE id = 1
        `).get()) {
            const oldHistory = readLegacy(
                path.join(dataDir, 'tracker-history.json')
            );

            const oldSnapshot = readLegacy(
                path.join(dataDir, 'clan-snapshot.json')
            );

            if (oldSnapshot && !oldHistory) {
                throw new Error(
                    'Cannot migrate snapshot without tracker-history.json. Restore the history file first.'
                );
            }

            save(
                { ...emptyHistory(), ...oldHistory },
                oldSnapshot
            );
        }

        return {
            load,
            save,
            close: () => db.close()
        };

    } catch (error) {
        db.close();
        throw error;
    }
}

module.exports = { openStore };