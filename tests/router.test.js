const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '../router.js'),
    'utf8'
);

function dashboard(initialPath) {
    const routes = [
        '/',
        '/wars',
        '/cwl',
        '/donations',
        '/members'
    ];

    const sections = [
        'overview',
        'wars',
        'wars',
        'cwl',
        'donations',
        'members'
    ].map(page => ({
        dataset: { page }
    }));

    const links = routes.map(route => ({
        dataset: { route },

        classList: {
            toggle() { }
        },

        setAttribute(name, value) {
            this[name] = value;
        },

        removeAttribute(name) {
            delete this[name];
        },

        addEventListener(type, fn) {
            this.click = fn;
        }
    }));

    const elements = {
        pageTitle: { focus() { } },
        subtitle: {},
        crumb: {}
    };

    const main = {
        dataset: {}
    };

    const document = {
        querySelectorAll(selector) {
            return selector.includes('section')
                ? sections
                : links;
        },

        querySelector() {
            return main;
        },

        getElementById(id) {
            return elements[id];
        }
    };

    const window = {
        location: {
            pathname: initialPath
        },

        history: {
            pushState(state, title, route) {
                window.location.pathname = route;
            }
        },

        scrollTo() { },

        addEventListener(type, fn) {
            this[type] = fn;
        }
    };

    vm.runInNewContext(source, {
        document,
        window
    });

    return {
        sections,
        links,
        elements,
        window
    };
}

test('Direct URL displays only the requested page', () => {
    const { sections, links, elements } = dashboard('/wars');

    assert.equal(
        elements.pageTitle.textContent,
        'Clan wars'
    );

    assert.equal(
        links[1]['aria-current'],
        'page'
    );

    assert.equal(
        sections.filter(s => !s.hidden).length,
        2
    );

    assert.ok(
        sections
            .filter(s => !s.hidden)
            .every(s => s.dataset.page === 'wars')
    );
});

test('Navigation updates the URL and supports browser back', () => {
    const {
        sections,
        links,
        elements,
        window
    } = dashboard('/');

    links[3].click({
        button: 0,
        preventDefault() { }
    });

    assert.equal(
        window.location.pathname,
        '/donations'
    );

    assert.equal(
        elements.crumb.textContent,
        'Donations'
    );

    assert.ok(
        sections
            .filter(s => !s.hidden)
            .every(s => s.dataset.page === 'donations')
    );

    window.location.pathname = '/';
    window.popstate();

    assert.equal(
        elements.crumb.textContent,
        'Overview'
    );

    assert.ok(
        sections
            .filter(s => !s.hidden)
            .every(s => s.dataset.page === 'overview')
    );
});