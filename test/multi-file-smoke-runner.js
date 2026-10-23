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
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),
      c => c.charCodeAt(0)
    );
    const source =
      '<!doctype html><html><head><title>Folder test</title><link rel="stylesheet" href="css/main.css"></head><body><h1>HTML page</h1><img src="images/logo.png"><picture><source srcset="images/logo.png 1x, images/logo.png 2x"><img src="images/logo.png"></picture><script>window.HTML_IMPORT_EXECUTED=true;window.addEventListener("load",()=>parent.postMessage({probe:"html-ready",image:document.querySelector("img").naturalWidth,color:getComputedStyle(document.querySelector("h1")).color},"*"));<' +
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
        file('site/css/nested.css', 'h1{color:green}', 'text/css'),
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
    check(
      collection.doc.querySelector('#vc iframe').getAttribute('sandbox').includes('allow-scripts'),
      'HTML page has a separate sandboxed preview'
    );
    await wait(() => collection.messages.some(message => message.probe === 'html-ready'), 'prepared HTML renders');
    const pageState = collection.messages.find(message => message.probe === 'html-ready');
    check(
      pageState.image > 0 && pageState.color === 'rgb(0, 128, 0)',
      'sandboxed HTML renders its embedded image and nested stylesheet'
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
