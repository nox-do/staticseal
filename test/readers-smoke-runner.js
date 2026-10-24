(async () => {
  const results = document.getElementById('results');
  const wait = async condition => {
    for (let n = 0; n < 300; n++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Timed out');
  };
  const check = condition => {
    if (!condition) throw new Error('Unexpected reader state');
  };
  try {
    for (const { kind, html } of window.readerCases) {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'width:800px;height:400px';
      frame.srcdoc = html;
      document.body.append(frame);
      await wait(() => frame.contentDocument?.getElementById('unlock-button'));
      frame.contentDocument.getElementById('unlock-button').click();
      await wait(() => frame.contentDocument?.getElementById('vc'));
      const doc = frame.contentDocument;
      if (kind === 'image') {
        await wait(() => doc.querySelector('#vc img')?.naturalWidth === 2);
      } else if (kind === 'markdown') {
        check(doc.querySelector('article h1')?.textContent === 'Heading');
        check(doc.querySelector('code .s-key')?.textContent === '"ok"');
      } else if (kind.startsWith('framed')) {
        if (kind === 'framed') {
          check(doc.querySelector('.vb') && !doc.querySelector('#choose-file,#download-all'));
          check(doc.getElementById('page-download').download === 'report.html');
        } else check(doc.getElementById('choose-file').options.length === 2);
        const page = doc.querySelector('#vc iframe');
        await wait(() => page.contentDocument?.querySelector('a'));
        page.contentDocument.querySelector('a').click();
        await wait(() => page.contentWindow.scrollY > 0);
        check(page.contentDocument.querySelector('h1')?.textContent === 'Report');
        if (kind === 'framed-collection') {
          doc.getElementById('next-file').click();
          check(doc.getElementById('tp').textContent === 'First entry');
          doc.getElementById('prev-file').click();
          await wait(
            () => doc.querySelector('#vc iframe')?.contentDocument?.querySelector('h1')?.textContent === 'Report'
          );
        }
      } else {
        check(doc.getElementById('choose-file').options.length === 2);
        check(doc.getElementById('tp').textContent === 'First entry');
        doc.getElementById('next-file').click();
        await wait(() => doc.querySelector('#vc img')?.naturalWidth === 2);
        check(doc.getElementById('download-all'));
      }
      const line = document.createElement('p');
      line.textContent = 'PASS ' + kind;
      results.append(line);
      frame.remove();
    }
    document.title = 'PASS 5 specialized readers';
  } catch (error) {
    results.append('FAIL ' + error.message);
    document.title = 'FAIL specialized readers';
  }
})();
