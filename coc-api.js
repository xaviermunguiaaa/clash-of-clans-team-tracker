const { setTimeout: delay } = require('node:timers/promises');

class ClashApiError extends Error {
    constructor(message, status = null, retryable = false) {
        super(message);

        this.name = 'ClashApiError';
        this.status = status;
        this.retryable = retryable;
    }
}

function retryAfterMs(value, now) {
    if (!value || !value.trim()) return null;

    const seconds = Number(value);

    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.ceil(seconds * 1000);
    }

    const date = Date.parse(value);

    return Number.isFinite(date)
        ? Math.max(0, date - now)
        : null;
}

function httpError(status) {
    if (status === 401 || status === 403) {
        return new ClashApiError(
            `Clash API access denied (${status}). Check the API key, allowed IP, or clan visibility.`,
            status
        );
    }

    if (status === 429) {
        return new ClashApiError(
            'Clash API rate limit reached.',
            status,
            true
        );
    }

    const retryable =
        status === 408 ||
        (status >= 500 && status <= 599);

    return new ClashApiError(
        `Clash API returned HTTP ${status}.`,
        status,
        retryable
    );
}

function createCocClient({
    token,
    fetchImpl = fetch,
    sleep = delay,
    now = Date.now,
    random = Math.random,
    maxAttempts = 3,
    timeoutMs = 20_000,
    maxWaitMs = 15_000
}) {
    let blockedUntil = 0;
    let blockedError = null;

    function backoff(attempt) {
        return Math.min(
            maxWaitMs,
            1000 * 2 ** (attempt - 1) +
            Math.floor(random() * 250)
        );
    }

    async function waitForCooldown() {
        while (blockedUntil > now()) {
            const remaining = blockedUntil - now();

            if (remaining > maxWaitMs) {
                throw blockedError;
            }

            await sleep(remaining);
        }
    }

    return async function coc(endpoint) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await waitForCooldown();

            let error;
            let retryDelay = backoff(attempt);

            try {
                const response = await fetchImpl(
                    `https://api.clashofclans.com/v1${endpoint}`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            Accept: 'application/json'
                        },

                        signal: AbortSignal.timeout(timeoutMs)
                    }
                );

                if (response.ok) {
                    const body = await response.json();

                    if (!body ||
                        typeof body !== 'object' ||
                        Array.isArray(body)) {

                        throw new ClashApiError(
                            'Clash API returned an invalid response.',
                            null,
                            true
                        );
                    }

                    return body;
                }

                error = httpError(response.status);

                const retryAfter = retryAfterMs(
                    response.headers.get('Retry-After'),
                    now()
                );

                if (response.status === 429 ||
                    (response.status === 503 &&
                        retryAfter !== null)) {

                    const cooldown = Math.max(
                        retryDelay,
                        retryAfter ?? 60_000
                    );

                    if (now() + cooldown >= blockedUntil) {
                        blockedUntil = now() + cooldown;
                        blockedError = error;
                    }

                    retryDelay = 0;
                }

                await response.body?.cancel().catch(() => { });

            } catch (cause) {
                error = cause instanceof ClashApiError
                    ? cause
                    : new ClashApiError(
                        'Clash API request failed or returned invalid JSON.',
                        null,
                        true
                    );
            }

            if (!error.retryable || attempt === maxAttempts) {
                throw error;
            }

            if (retryDelay > 0) {
                await sleep(retryDelay);
            }
        }
    };
}

module.exports = {
    ClashApiError,
    createCocClient,
    retryAfterMs
};