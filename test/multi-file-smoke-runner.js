(async () => {
  const results = document.createElement('pre');
  results.id = 'test-results';
  document.body.prepend(results);
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.textContent += 'PASS ' + message + '\n';
  };
  const wait = async (condition, message) => {
    for (let n = 0; n < 50000; n++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Timed out: ' + message);
  };
  const $ = id => document.getElementById(id);
  const downloads = [],
    blobs = new Map();
  const createUrl = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => {
    const url = createUrl(blob);
    blobs.set(url, blob);
    return url;
  };
  HTMLAnchorElement.prototype.click = function () {
    downloads.push({ name: this.download, blob: blobs.get(this.href) });
  };
  window.addEventListener('error', event => {
    results.textContent += 'ERROR ' + event.message + '\n';
  });
  const file = (path, text, type = '') => {
    const value = new File([text], path.split('/').pop(), { type });
    if (path.includes('/')) Object.defineProperty(value, 'webkitRelativePath', { value: path });
    return value;
  };
  const clear = async () => {
    while ($('selection-list').children.length) {
      $('selection-list').querySelector('button[aria-label^="Remove"]').click();
    }
    await wait(() => !$('encrypt-button').disabled, 'empty selection');
  };
  const choose = async (files, folder = false) => {
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    const input = $(folder ? 'source-folder' : 'source-file');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
    await wait(() => !$('encrypt-button').disabled, $('selection-report').textContent);
  };
  const seal = async password => {
    $('password').value = $('password-repeat').value = password;
    const before = downloads.length;
    $('encrypt-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await wait(() => downloads.length > before || $('status').dataset.kind === 'error', 'package creation');
    check(downloads.length === before + 1, 'creator produces one HTML download: ' + $('status').textContent);
    check(
      /^sealed_\d{6}_\d{4}\.html$/.test(downloads.at(-1).name),
      'outer filename contains only local date, hour and minute'
    );
    return downloads.at(-1).blob.text();
  };
  const open = async (html, password = '', wrongPassword = false) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:900px;height:600px';
    frame.srcdoc = html;
    document.body.append(frame);
    await new Promise(resolve => (frame.onload = resolve));
    const win = frame.contentWindow,
      doc = frame.contentDocument,
      objectUrls = new Map(),
      messages = [];
    win.addEventListener('message', event => messages.push(event.data));
    const create = win.URL.createObjectURL.bind(win.URL);
    win.URL.createObjectURL = blob => {
      const url = create(blob);
      objectUrls.set(url, blob);
      return url;
    };
    if (wrongPassword) {
      doc.getElementById('password').value = 'wrong password';
      doc.getElementById('unlock-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
      await wait(() => doc.getElementById('status')?.dataset.kind === 'error', 'wrong passphrase rejected');
      check(true, 'wrong passphrase rejected');
    }
    if (doc.getElementById('password')) doc.getElementById('password').value = password;
    doc.getElementById('unlock-form').dispatchEvent(new win.Event('submit', { cancelable: true }));
    await wait(() => doc.querySelector('.vs') || !doc.getElementById('unlock-form'), 'reader opens');
    return { frame, win, doc, objectUrls, messages };
  };
  try {
    check($('source-file').multiple && $('source-folder').webkitdirectory, 'separate file and folder selection');
    check(!$('private-filename'), 'filename privacy is automatic with no checkbox');
    check($('source-folder').getBoundingClientRect().height <= 60, 'folder picker stays inside its own control');
    const dropZone = $('source-file').closest('.file-picker');
    check(dropZone.contains($('source-folder')), 'both pickers are inside the drop zone');
    const drop = items => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { items, files: [] } });
      dropZone.dispatchEvent(event);
      check(event.defaultPrevented, 'drop prevents native file navigation');
    };
    const directory = (name, batches) => ({
      name,
      isDirectory: true,
      createReader: () => {
        let next = 0;
        return { readEntries: resolve => resolve(batches[next++] || []) };
      }
    });
    const droppedFile = (name, text, type) => ({
      name,
      isFile: true,
      file: resolve => resolve(file(name, text, type))
    });
    drop([
      {
        kind: 'file',
        webkitGetAsEntry: () =>
          directory('dropped-site', [
            [droppedFile('index.html', '<link rel="stylesheet" href="css/main.css"><h1>Dropped</h1>', 'text/html')],
            [directory('css', [[droppedFile('main.css', 'h1{color:green}', 'text/css')]])]
          ])
      }
    ]);
    await wait(() => $('selection-list').children.length === 2 && !$('encrypt-button').disabled, 'directory drop');
    check(
      $('selection-list').textContent.includes('dropped-site/css/main.css') &&
        $('selection-report').textContent.includes('1 resource(s) embedded'),
      'directory drop preserves nested paths and reads all directory batches'
    );
    check(!document.querySelector('[aria-label^="Move up"]'), 'website selection has no ordering controls');
    drop([
      {
        kind: 'file',
        webkitGetAsEntry: () => ({
          name: 'unreadable',
          isDirectory: true,
          createReader: () => ({ readEntries: (_, reject) => reject(new Error('denied')) })
        })
      }
    ]);
    await wait(() => $('status').textContent.includes('denied'), 'directory read error');
    check($('selection-list').children.length === 2, 'failed drop preserves the previous selection');
    await clear();
    drop([{ kind: 'file', getAsFile: () => file('dropped.txt', 'Dropped file', 'text/plain') }]);
    await wait(() => $('selection-list').children.length === 1 && !$('encrypt-button').disabled, 'plain file drop');
    check(!document.querySelector('[aria-label^="Move up"]'), 'independent files have no ordering controls');
    await clear();
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),
      c => c.charCodeAt(0)
    );
    const source =
      '<!doctype html><html><head><title>Folder test</title><link rel="stylesheet" href="css/main.css"></head><body><h1>HTML page</h1><a id="jump" href="#local">Jump</a><div style="height:700px"></div><h2 id="local">Local anchor</h2><img src="images/logo.png"><picture><source srcset="images/logo.png 1x, images/logo.png 2x"><img src="images/logo.png"></picture><script>window.HTML_IMPORT_EXECUTED=true;window.addEventListener("load",()=>parent.postMessage({probe:"html-ready",image:document.querySelector("img").naturalWidth,color:getComputedStyle(document.querySelector("h1")).color},"*"));<' +
      '/script></body></html>';
    await choose(
      [
        file('site/index.html', source, 'text/html'),
        file('site/images/logo.png', png, 'image/png'),
        file(
          'site/css/main.css',
          '@import "nested.css";body{background:url(../images/logo.png)}@font-face{font-family:Demo;src:url(../font.woff2)}p:before{content:"url(fake.png)"}/* url(fake2.png) */',
          'text/css'
        ),
        file('site/css/nested.css', 'h1{color:green}.vb{display:none}', 'text/css'),
        file('site/font.woff2', 'font test', 'font/woff2'),
        file('site/notes.txt', 'Original notes ä', 'text/plain')
      ],
      true
    );
    check(
      $('selection-report').textContent.includes('index.html recognized') &&
        $('selection-report').textContent.includes('4 resource(s)'),
      'folder paths identify index, image, imported CSS and font'
    );
    check(!window.HTML_IMPORT_EXECUTED, 'import does not execute selected HTML scripts');
    check(
      !$('selection-report').textContent.includes('fake.png'),
      'CSS strings and comments do not create dependencies'
    );
    $('download-prepared').click();
    const preparedHtml = await downloads.at(-1).blob.text();
    check(
      preparedHtml.includes('data:image/png;base64,') && preparedHtml.includes('data:text/css;base64,'),
      'prepared HTML embeds images and CSS'
    );
    check(preparedHtml.includes('srcset="data:image/png;base64,'), 'responsive images are embedded');
    const collectionHtml = await seal('');
    const collection = await open(collectionHtml);
    check(
      collection.doc.getElementById('choose-file').options.length === 2,
      'embedded assets are omitted from collection navigation'
    );
    const toolbar = collection.doc.querySelector('.vb');
    check(
      ['prev-file', 'next-file', 'choose-file', 'download-all'].every(id =>
        toolbar.contains(collection.doc.getElementById(id))
      ) && toolbar.getBoundingClientRect().height < 60,
      'collection navigation and downloads share one compact desktop toolbar'
    );
    check(
      collection.win.getComputedStyle(collection.doc.getElementById('download-all')).backgroundColor ===
        collection.win.getComputedStyle(collection.doc.querySelector('.va a')).backgroundColor,
      'individual and ZIP downloads use matching button styles'
    );
    const pageFrame = collection.doc.querySelector('#vc iframe');
    check(!pageFrame.hasAttribute('sandbox'), 'HTML page keeps its iframe without sandbox restrictions');
    await wait(() => collection.messages.some(message => message.probe === 'html-ready'), 'prepared HTML renders');
    const pageState = collection.messages.find(message => message.probe === 'html-ready');
    check(
      pageState.image > 0 && pageState.color === 'rgb(0, 128, 0)',
      'HTML renders its embedded image and nested stylesheet'
    );
    const pageDoc = pageFrame.contentDocument;
    pageDoc.getElementById('jump').click();
    await wait(() => pageDoc.defaultView.scrollY > 0, 'single-page fragment scrolls inside its preview');
    check(
      pageFrame.contentDocument === pageDoc && !pageDoc.querySelector('iframe, #unlock-form'),
      'single-page anchor keeps its document and never embeds the package again'
    );
    check(
      pageDoc.querySelector('h1').textContent === 'HTML page' &&
        pageFrame.contentWindow.parent.document === collection.doc,
      'viewer and HTML page can access each other directly'
    );
    const localLink = pageDoc.createElement('a');
    localLink.href = 'notes.txt';
    localLink.textContent = 'Notes';
    pageDoc.body.append(localLink);
    let intercepted = false;
    pageDoc.addEventListener('click', event => {
      if (event.target === localLink) {
        event.preventDefault();
        intercepted = true;
      }
    });
    localLink.click();
    check(intercepted, 'viewer can intercept page links without injected scripts or postMessage');
    check(
      collection.win.getComputedStyle(collection.doc.querySelector('.vb')).display !== 'none',
      'page CSS remains isolated from viewer navigation and downloads'
    );
    collection.doc.getElementById('next-file').click();
    check(
      collection.doc.getElementById('vc').textContent.includes('Original notes ä'),
      'next file previews original text'
    );
    collection.doc.getElementById('prev-file').click();
    check(collection.doc.getElementById('choose-file').selectedIndex === 0, 'previous file returns to page');
    const zip = collection.doc.getElementById('download-all');
    zip.dispatchEvent(new collection.win.MouseEvent('click', { cancelable: true }));
    const zipBytes = new Uint8Array(await collection.objectUrls.get(zip.href).arrayBuffer());
    check(new DataView(zipBytes.buffer).getUint32(0, true) === 0x04034b50, 'download-all builds a ZIP locally');
    const zipEvidence = document.createElement('script');
    zipEvidence.id = 'test-zip';
    zipEvidence.type = 'application/json';
    zipEvidence.textContent = JSON.stringify({ base64: btoa(String.fromCharCode(...zipBytes)) });
    document.body.append(zipEvidence);
    collection.frame.remove();
    await clear();
    const siteFiles = [
      file(
        'site/index.html',
        '<link rel="stylesheet" href="shared.css"><h1>Home</h1><a id="jump" href="#local">Jump</a><div style="height:700px"></div><h2 id="local">Local anchor</h2><a id="guide" href="guide/#chapter">Guide</a><img src="pic.png"><a id="asset" href="pic.png">Image</a>',
        'text/html'
      ),
      file(
        'site/guide/index.html',
        '<link rel="stylesheet" href="../shared.css"><div style="height:700px"></div><h1 id="chapter">Guide</h1><img src="../pic.png"><a id="contact" href="../contact.html">Contact</a><a id="home" href="../index.html">Home</a><script>window.visits=(window.visits||0)+1;<' +
          '/script>',
        'text/html'
      ),
      file('site/contact.html', '<h1>Contact</h1><a id="home" href="index.html">Home</a>', 'text/html'),
      file('site/shared.css', 'h1{color:green}', 'text/css'),
      file('site/pic.png', png, 'image/png'),
      file('site/notes.txt', 'Independent attachment', 'text/plain')
    ];
    await choose(siteFiles, true);
    check(
      $('selection-report').textContent.includes('2 linked page(s)'),
      'root index accepts nested indexes and discovers recursive subpages'
    );
    $('download-prepared').click();
    const websiteHtml = await downloads.at(-1).blob.text();
    const website = await open(await seal('browser-test-only'), 'browser-test-only');
    const siteDoc = () =>
      website.doc.querySelector('#vc > iframe')?.contentDocument?.querySelector('iframe')?.contentDocument;
    await wait(() => siteDoc()?.readyState === 'complete' && siteDoc()?.getElementById('guide'), 'website home loads');
    check(
      website.doc.getElementById('choose-file').options.length === 2,
      'embedded pages, shared CSS and linked images are absent from file navigation'
    );
    check(
      siteDoc().getElementById('asset').getAttribute('href').startsWith('data:image/png'),
      'ordinary image links use embedded assets without duplicate files'
    );
    const homeDoc = siteDoc();
    homeDoc.defaultView.anchorProbe = 'preserved';
    homeDoc.getElementById('jump').click();
    await wait(() => siteDoc()?.defaultView.scrollY > 0, 'website fragment scrolls locally');
    check(
      siteDoc() === homeDoc &&
        siteDoc().defaultView.anchorProbe === 'preserved' &&
        !siteDoc().querySelector('iframe, #unlock-form'),
      'website anchor preserves script state and avoids nested package viewers'
    );
    siteDoc().getElementById('guide').click();
    await wait(() => siteDoc()?.getElementById('contact'), 'directory-index link opens guide');
    await wait(() => siteDoc()?.defaultView.scrollY > 0, 'cross-page anchor scrolls to the target');
    check(
      siteDoc().getElementById('chapter') &&
        website.win.getComputedStyle(siteDoc().querySelector('h1')).color === 'rgb(0, 128, 0)',
      'subpage restores its anchor, shared styles and fresh scripts'
    );
    check(siteDoc().defaultView.visits === 1, 'subpage JavaScript executes in a fresh page context');
    siteDoc().getElementById('contact').click();
    await wait(
      () => siteDoc()?.readyState === 'complete' && siteDoc()?.querySelector('h1')?.textContent === 'Contact',
      'recursive link opens contact'
    );
    website.doc.querySelector('#vc > iframe').contentWindow.history.back();
    await wait(() => siteDoc()?.getElementById('contact'), 'browser Back restores guide');
    check(siteDoc().defaultView.visits === 1, 'back navigation does not reuse stale script globals');
    siteDoc().getElementById('home').click();
    await wait(
      () => siteDoc()?.readyState === 'complete' && siteDoc()?.getElementById('guide'),
      'cyclic link returns home'
    );
    const siteWindow = website.doc.querySelector('#vc > iframe').contentWindow;
    const siteErrors = [];
    siteWindow.addEventListener('error', event => siteErrors.push(event.message));
    const imageLoaded = new Promise(resolve =>
      siteWindow.document.querySelector('iframe').addEventListener('load', resolve, { once: true })
    );
    siteDoc().getElementById('asset').click();
    await imageLoaded;
    check(!siteDoc() && !siteErrors.length, 'opening an embedded image handles its opaque origin without a DOM error');
    siteWindow.history.back();
    await wait(() => siteDoc()?.getElementById('guide'), 'Back returns from the embedded image');
    website.doc.getElementById('next-file').click();
    check(
      website.doc.getElementById('vc').textContent.includes('Independent attachment'),
      'file navigation still reaches independent attachments'
    );
    website.doc.getElementById('prev-file').click();
    await wait(() => siteDoc()?.getElementById('guide'), 'file navigation returns to website');
    website.frame.remove();
    const standalone = document.createElement('iframe');
    standalone.srcdoc = websiteHtml;
    document.body.append(standalone);
    const standaloneDoc = () => standalone.contentDocument?.querySelector('iframe')?.contentDocument;
    await wait(() => standaloneDoc()?.getElementById('guide'), 'prepared website loads independently');
    standaloneDoc().getElementById('guide').click();
    await wait(() => standaloneDoc()?.getElementById('contact'), 'prepared HTML alone supports subpage navigation');
    check(true, 'prepared website is self-contained without the collection viewer');
    standalone.remove();
    await clear();
    await choose(siteFiles.slice(0, -1), true);
    const onlyWebsite = await open(await seal(''));
    await wait(
      () => onlyWebsite.doc.querySelector('iframe')?.contentDocument?.getElementById('guide'),
      'website-only package opens'
    );
    check(
      !onlyWebsite.doc.querySelector('.vb, #choose-file'),
      'a website without independent attachments has no viewer header'
    );
    onlyWebsite.doc.querySelector('iframe').contentDocument.getElementById('guide').click();
    await wait(
      () => onlyWebsite.doc.querySelector('iframe')?.contentDocument?.getElementById('contact'),
      'header-free website still navigates'
    );
    onlyWebsite.frame.remove();
    await clear();
    await choose([
      file('a.pdf', '%PDF-1.4\n' + 'fixture content\n'.repeat(1024), 'application/pdf'),
      file('b.png', png, 'image/png')
    ]);
    const protectedHtml = await seal('browser-test-only');
    const metadata = JSON.parse(
      protectedHtml.match(/<script id="encrypted-payload" type="application\/json">(.*?)<\/script>/s)[1]
    );
    check(metadata.v === 3, 'encrypted collection uses gzip when smaller');
    check(
      metadata.filename === undefined && metadata.contentType === undefined,
      'private collection hides public file metadata'
    );
    const protectedReader = await open(protectedHtml, 'browser-test-only', true);
    check(
      protectedReader.doc.getElementById('choose-file').options.length === 2,
      'encrypted PDF/image collection opens'
    );
    check(protectedReader.doc.getElementById('pdf'), 'PDF notice appears before first PDF preview');
    protectedReader.doc.getElementById('next-file').click();
    check(protectedReader.doc.querySelector('#vc img'), 'image preview works after PDF navigation');
    check(
      protectedReader.doc.title === 'b.png' && protectedReader.doc.querySelector('a[download="b.png"]'),
      'preview title and individual download restore original filename'
    );
    protectedReader.frame.remove();
    await clear();
    await choose([file('index.html', '<h1>one</h1>', 'text/html'), file('INDEX.HTM', '<h1>two</h1>', 'text/html')]);
    check(
      $('selection-report').textContent.includes('HTML structure not recognized'),
      'duplicate index variants fall back to individual files'
    );
    const ambiguousReader = await open(await seal(''));
    check(
      ambiguousReader.doc.getElementById('choose-file').options.length === 2 &&
        !ambiguousReader.doc.querySelector('#vc iframe'),
      'ambiguous HTML is escaped source, not an active page'
    );
    ambiguousReader.frame.remove();
    await clear();
    await choose([
      file(
        'report.html',
        '<h1>Report</h1><img src="missing.png"><link rel="stylesheet" href="missing.css">',
        'text/html'
      )
    ]);
    check(
      $('selection-report').textContent.includes('missing.png') &&
        $('selection-report').textContent.includes('missing.css'),
      'missing resources warn without blocking recognized HTML'
    );
    const incomplete = await open(await seal(''));
    check(
      incomplete.doc.querySelector('.vb') &&
        !incomplete.doc.getElementById('choose-file') &&
        !incomplete.doc.getElementById('download-all') &&
        incomplete.doc.querySelector('#vc > iframe'),
      'an incomplete single website keeps the viewer header'
    );
    incomplete.frame.remove();
    await clear();
    await choose([
      file('index.html', '<img src="pic.png"><a download href="pic.png">Original</a>', 'text/html'),
      file('pic.png', png, 'image/png')
    ]);
    $('download-prepared').click();
    const downloadDoc = new DOMParser().parseFromString(await downloads.at(-1).blob.text(), 'text/html');
    check(
      downloadDoc.querySelector('a[download]').getAttribute('href') ===
        downloadDoc.querySelector('img').getAttribute('src'),
      'embedded image retains its original download link'
    );
    await clear();
    await choose([
      file('index.html', '<link rel="stylesheet" href="styles">', 'text/html'),
      file('styles', 'body{background:url(pic.png)}', 'text/css'),
      file('pic.png', png, 'image/png')
    ]);
    $('download-prepared').click();
    const extensionlessDoc = new DOMParser().parseFromString(await downloads.at(-1).blob.text(), 'text/html');
    const extensionlessCss = atob(extensionlessDoc.querySelector('link').getAttribute('href').split(',')[1]);
    check(extensionlessCss.includes('data:image/png;base64,'), 'extensionless stylesheet embeds its image dependency');
    await clear();
    await choose([
      file(
        'index.html',
        '<style>body{background-image:image-set("pic.png" 1x)}</style><img src="sprite.svg"><svg><use href="sprite.svg#icon"></use></svg>',
        'text/html'
      ),
      file('pic.png', png, 'image/png'),
      file('sprite.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml')
    ]);
    check(
      $('selection-report').textContent.includes('image-set()') &&
        $('selection-report').textContent.includes('sprite.svg#icon'),
      'unsupported CSS and SVG references produce concrete warnings'
    );
    const retainedReader = await open(await seal(''));
    check(
      retainedReader.doc.getElementById('choose-file').options.length === 3,
      'resources with remaining references stay in the actual collection'
    );
    retainedReader.frame.remove();
    await clear();
    await choose([
      file(
        'index.html',
        '<img src="https://staticseal-import-probe.invalid/image"><iframe src="https://staticseal-import-probe.invalid/frame"></iframe><link rel="stylesheet" href="https://staticseal-import-probe.invalid/style"><script src="https://staticseal-import-probe.invalid/script"><' +
          '/script>',
        'text/html'
      )
    ]);
    check(
      $('selection-report').textContent.includes('External dependency:'),
      'external resource fixture is reported without fetching it in importer code'
    );
    await clear();
    await choose([file('single.txt', 'single original', 'text/plain')]);
    const single = await open(await seal(''));
    check(
      !single.doc.getElementById('choose-file') &&
        single.doc.getElementById('vc').textContent.includes('single original'),
      'single file retains the original compact reader'
    );
    single.frame.remove();
    results.textContent += 'ALL PASSED\n';
    document.documentElement.dataset.testResult = 'passed';
  } catch (error) {
    results.textContent += 'FAIL ' + error.stack + '\n';
    document.documentElement.dataset.testResult = 'failed';
  }
})();
