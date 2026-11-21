const pages = {
    '/': {
        key: 'overview',
        label: 'Overview',
        title: 'Clan dashboard',
        subtitle: 'Clan performance and leaderboard at a glance.'
    },

    '/wars': {
        key: 'wars',
        label: 'Clan war',
        title: 'Clan wars',
        subtitle: 'Current war, recent participation and war history.'
    },

    '/cwl': {
        key: 'cwl',
        label: 'CWL',
        title: 'Clan War League',
        subtitle: 'Current league standings and archived seasons.'
    },

    '/donations': {
        key: 'donations',
        label: 'Donations',
        title: 'Donations',
        subtitle: 'Track donation totals and player rankings.'
    },

    '/members': {
        key: 'members',
        label: 'Members',
        title: 'Clan members',
        subtitle: 'Search the roster and open individual player profiles.'
    }
};

function currentRoute() {
    const path = window.location.pathname;

    return Object.hasOwn(pages, path) ? path : '/';
}

function showPage(focusHeading = false) {
    const route = currentRoute();
    const page = pages[route];

    document.querySelector('main').dataset.route = page.key;

    document.querySelectorAll('main section[data-page]')
        .forEach(section => {
            section.hidden = section.dataset.page !== page.key;
        });

    document.querySelectorAll('.nav a[data-route]')
        .forEach(link => {
            const active = link.dataset.route === route;

            link.classList.toggle('active', active);

            if (active) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });

    const heading = document.getElementById('pageTitle');

    heading.textContent = page.title;

    document.getElementById('subtitle').textContent =
        page.subtitle;

    document.getElementById('crumb').textContent =
        page.label;

    document.title = 'Clash Ledger — ' + page.label;

    if (focusHeading) {
        heading.focus({ preventScroll: true });

        window.scrollTo({
            top: 0,
            behavior: 'auto'
        });
    }
}

document.querySelectorAll('.nav a[data-route]')
    .forEach(link => {
        link.addEventListener('click', event => {
            // Preserve normal browser behavior for new tabs.
            if (event.defaultPrevented || event.button !== 0 ||
                event.ctrlKey || event.metaKey ||
                event.shiftKey || event.altKey) {
                return;
            }

            event.preventDefault();

            if (window.location.pathname !== link.dataset.route) {
                window.history.pushState(
                    null,
                    '',
                    link.dataset.route
                );
            }

            showPage(true);
        });
    });

window.addEventListener('popstate', () => showPage(true));

showPage();