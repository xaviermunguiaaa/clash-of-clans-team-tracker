const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    createCocClient,
    retryAfterMs
} = require('../coc-api');

function fixture(responses) {
    let currentTime = Date.parse('2026-11-21T12:00:00Z');
    let calls = 0;

    const waits = [];

    const client = createCocClient({
        token: 'test-token',

        fetchImpl: async () => {
            const response = responses[calls++];

            if (response instanceof Error) {
                throw response;
            }

            return response;
        },

        now: () => currentTime,
        random: () => 0,

        sleep: async ms => {
            waits.push(ms);
            currentTime += ms;
        }
    });

    return {
        client,
        waits,
        calls: () => calls,
        advance: ms => {
            currentTime += ms;
        }
    };
}

function ok() {
    return Response.json({
        tag: '#TEST'
    });
}

test('Retries network errors and temporary server failures', async () => {
    const f = fixture([
        new TypeError('Network failure'),
        new Response('', { status: 502 }),
        ok()
    ]);

    assert.deepEqual(
        await f.client('/clans/test'),
        { tag: '#TEST' }
    );

    assert.equal(f.calls(), 3);
    assert.deepEqual(f.waits, [1000, 2000]);
});

test('Authorization failures and missing resources are not retried', async () => {
    for (const status of [401, 403, 404]) {
        const f = fixture([
            new Response('', { status })
        ]);

        await assert.rejects(
            f.client('/clans/test'),
            error => error.status === status
        );

        assert.equal(f.calls(), 1);
        assert.deepEqual(f.waits, []);
    }
});

test('Retries invalid JSON instead of accepting an empty snapshot', async () => {
    const f = fixture([
        new Response('not json', { status: 200 }),
        ok()
    ]);

    assert.deepEqual(
        await f.client('/clans/test'),
        { tag: '#TEST' }
    );

    assert.equal(f.calls(), 2);
});

test('Stops after three failed requests', async () => {
    const f = fixture([
        new Response('', { status: 500 }),
        new Response('', { status: 500 }),
        new Response('', { status: 500 })
    ]);

    await assert.rejects(
        f.client('/clans/test'),
        { status: 500 }
    );

    assert.equal(f.calls(), 3);
    assert.deepEqual(f.waits, [1000, 2000]);
});

test('Honors a short Retry-After header', async () => {
    const f = fixture([
        new Response('', {
            status: 429,
            headers: {
                'Retry-After': '3'
            }
        }),

        ok()
    ]);

    assert.deepEqual(
        await f.client('/clans/test'),
        { tag: '#TEST' }
    );

    assert.deepEqual(f.waits, [3000]);
    assert.equal(f.calls(), 2);
});

test('Long rate-limit cooldown prevents requests to other endpoints', async () => {
    const f = fixture([
        new Response('', {
            status: 429,
            headers: {
                'Retry-After': '120'
            }
        }),

        ok()
    ]);

    await assert.rejects(
        f.client('/clans/test'),
        { status: 429 }
    );

    await assert.rejects(
        f.client('/clans/test/currentwar'),
        { status: 429 }
    );

    assert.equal(f.calls(), 1);
    assert.deepEqual(f.waits, []);

    f.advance(120_000);

    assert.deepEqual(
        await f.client('/clans/test/currentwar'),
        { tag: '#TEST' }
    );

    assert.equal(f.calls(), 2);
});

test('Retry-After supports seconds and HTTP dates', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');

    assert.equal(
        retryAfterMs('5', now),
        5000
    );

    assert.equal(
        retryAfterMs(
            new Date(now + 10_000).toUTCString(),
            now
        ),
        10_000
    );

    assert.equal(
        retryAfterMs('invalid', now),
        null
    );
});