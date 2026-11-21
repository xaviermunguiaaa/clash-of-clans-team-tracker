const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

let server;
let testDir;
let baseUrl;

const sampleSnapshot = {
    clan: {
        name: 'Test Clan',
        tag: '#TEST',
        members: 1,
        memberList: [
            { tag: '#PLAYER', name: 'Test Player', donations: 100 }
        ]
    },
    history: {}
};

function getFreePort() {
    return new Promise((resolve, reject) => {
        const socket = net.createServer();

        socket.once('error', reject);

        socket.listen(0, '127.0.0.1', () => {
            const port = socket.address().port;
            socket.close(() => resolve(port));
        });
    });
}

before(async () => {
    // Use an isolated copy of the server and fake clan data.
    testDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'clash-ledger-test-')
    );

    const root = path.join(__dirname, '..');

    for (const file of [
        'server.js',
        'database.js',
        'index.html',
        'app.js',
        'styles.css',
        'package.json'
    ]) {
        fs.copyFileSync(
            path.join(root, file),
            path.join(testDir, file)
        );
    }

    const dataDir = path.join(testDir, 'data');
    fs.mkdirSync(dataDir);

    fs.writeFileSync(
        path.join(dataDir, 'clan-snapshot.json'),
        JSON.stringify(sampleSnapshot)
    );

    fs.writeFileSync(
        path.join(dataDir, 'tracker-history.json'),
        '{}'
    );

    fs.mkdirSync(path.join(testDir, '.git'));

    fs.writeFileSync(
        path.join(testDir, '.git', 'config'),
        'Test repository'
    );

    const port = await getFreePort();
    baseUrl = `http://127.0.0.1:${port}`;

    server = spawn(process.execPath, ['server.js'], {
        cwd: testDir,
        env: {
            ...process.env,
            COC_API_TOKEN: '',
            DATA_DIR: dataDir,
            PORT: String(port)
        },
        stdio: ['ignore', 'pipe', 'inherit']
    });

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Server did not start'));
        }, 5000);

        let output = '';

        server.stdout.on('data', chunk => {
            output += chunk.toString();

            if (output.includes('Clash Ledger listening')) {
                clearTimeout(timeout);
                resolve();
            }
        });

        server.once('error', error => {
            clearTimeout(timeout);
            reject(error);
        });

        server.once('exit', code => {
            clearTimeout(timeout);
            reject(new Error(`Server exited with code ${code}`));
        });
    });
});

after(async () => {
    if (server && server.exitCode === null &&
        server.signalCode === null) {
        const exited = once(server, 'exit');
        server.kill();
        await exited;
    }

    if (testDir) {
        fs.rmSync(testDir, { recursive: true, force: true });
    }
});

test('Dashboard loads successfully', async () => {
    const response = await fetch(`${baseUrl}/`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
});

test('Approved frontend files are accessible', async () => {
    for (const route of ['/index.html', '/app.js?v=test']) {
        const response = await fetch(`${baseUrl}${route}`);

        assert.equal(response.status, 200);
    }
});

test('Clan API returns cached data', async () => {
    const response = await fetch(`${baseUrl}/api/clan`);

    assert.equal(response.status, 200);

    const data = await response.json();

    assert.equal(data.clan.name, 'Test Clan');
    assert.equal(data.clan.memberList[0].donations, 100);
});

test('Manual donation submissions are rejected', async () => {
    const response = await fetch(`${baseUrl}/api/donations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: 'Test Player',
            troop: 'Electro Dragon',
            qty: 5000000
        })
    });

    assert.equal(response.status, 410);
});

test('Rejected donations do not change cached statistics', async () => {
    const response = await fetch(`${baseUrl}/api/clan`);
    const data = await response.json();

    assert.equal(data.clan.memberList[0].donations, 100);
});

test('Backend and repository files are blocked', async () => {
    for (const route of [
        '/server.js',
        '/database.js',
        '/package.json',
        '/.git/config'
    ]) {
        const response = await fetch(`${baseUrl}${route}`);

        assert.equal(response.status, 404, route);
    }
});

test('Stored data files are blocked', async () => {
    for (const route of [
        '/data/clan-snapshot.json',
        '/data/tracker-history.json',
        '/data/clash-ledger.sqlite',
        '/data/clash-ledger.sqlite-journal'
    ]) {
        const response = await fetch(`${baseUrl}${route}`);

        assert.equal(response.status, 404, route);
    }
});

test('Unsupported HTTP methods are rejected', async () => {
    const response = await fetch(`${baseUrl}/app.js`, {
        method: 'POST'
    });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('Unknown routes return 404', async () => {
    const response = await fetch(`${baseUrl}/does-not-exist`);

    assert.equal(response.status, 404);
});

test('Dashboard links to an accessible stylesheet', async () => {
    const page = await fetch(`${baseUrl}/`);

    assert.equal(page.status, 200);
    assert.match(await page.text(), /href="\/styles\.css"/);

    const response = await fetch(`${baseUrl}/styles.css`);

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/css/);
    assert.match(await response.text(), /@media/);
});