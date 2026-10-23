// Serialized into prepared multi-page HTML; independent of the outer file viewer.
export function openWebsite([pages, assets, prefix]) {
  const show = () => {
    const route = location.hash.match(/^#seal-page=(\d+)(?:&anchor=(.*))?$/);
    const index = route && Number(route[1]) < pages.length ? Number(route[1]) : 0;
    const frame = document.createElement('iframe');
    frame.title = document.title;
    frame.onload = () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      document.title = frame.title = doc.title || document.title;
      const scroll = hash => {
        try {
          const name = decodeURIComponent(hash.slice(1));
          const target = doc.getElementById(name) || doc.getElementsByName(name)[0];
          if (target) target.scrollIntoView();
          else if (!name || name.toLowerCase() === 'top') frame.contentWindow.scrollTo(0, 0);
        } catch {
          /* Ignore malformed fragments without breaking navigation. */
        }
      };
      doc.addEventListener('click', event => {
        const link = event.target.closest?.('a[href]');
        if (!link || event.defaultPrevented || event.button !== 0) return;
        const page = link.getAttribute('data-seal-page');
        const href = link.getAttribute('href');
        if (page === null && !href.startsWith('#')) return;
        event.preventDefault();
        if (page === null) {
          scroll(href);
          return;
        }
        const next = '#seal-page=' + page + '&anchor=' + encodeURIComponent(link.hash);
        if (location.hash === next) show();
        else location.hash = next;
      });
      if (route?.[2]) {
        try {
          scroll(decodeURIComponent(route[2]));
        } catch {
          /* Ignore malformed fragments without breaking navigation. */
        }
      }
    };
    frame.srcdoc = pages[index].replace(new RegExp(prefix + '(\\d+);', 'g'), (match, n) => assets[n] ?? match);
    // Replacing the frame gives each page fresh globals and no stale iframe history.
    document.body.replaceChildren(frame);
  };
  window.addEventListener('hashchange', show);
  show();
}
