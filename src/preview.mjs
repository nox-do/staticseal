// Small, offline preview helpers. Markdown intentionally supports a basic subset.
// All source HTML is escaped; only explicitly permitted link schemes are emitted.
export function createPreview() {
  const textExtensions = 'txt log csv tsv json jsonl xml yaml yml toml ini cfg conf env css scss less js mjs cjs jsx ts tsx py rb php sh bash zsh fish sql c h cpp hpp cs java go rs swift kt lua r vue svelte html htm xhtml tex diff patch'.split(' ');
  const types = { __proto__: null, html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
      pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
      md: 'text/markdown', markdown: 'text/markdown' };
  function inferContentType(filename, provided = '') {
    const extension = filename.toLowerCase().split('.').pop();
    if (provided && provided.toLowerCase().split(';')[0].trim() !== 'application/octet-stream') return provided;
    return types[extension] || (textExtensions.includes(extension) || /^(dockerfile|makefile|license|readme)$/i.test(filename)
      ? 'text/plain' : provided || 'application/octet-stream');
  }
  function previewKind(filename, contentType) {
    const type = inferContentType(filename, contentType).toLowerCase().split(';')[0].trim();
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].includes(type)) return 'image';
    if (type === 'application/pdf') return 'pdf';
    if (['text/markdown', 'text/x-markdown'].includes(type) || /\.(md|markdown)$/i.test(filename)) return 'markdown';
    if (type.startsWith('text/') || /^(application\/(json|xml|javascript|x-javascript|x-yaml|yaml|toml|x-sh|sql|x-httpd-php|xhtml\+xml)|[^/]+\/[^;]+\+(json|xml))$/.test(type)
      || inferContentType(filename).startsWith('text/')) return 'text';
    return 'download';
  }
  const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function codeLanguage(filename, type = '') {
    const extension = filename.toLowerCase().split('.').pop();
    type = type.toLowerCase().split(';')[0].trim();
    if (/^(html?|xhtml)$/.test(extension) || ['text/html', 'application/xhtml+xml'].includes(type)) return 'html';
    if (/^jsonl?$/.test(extension) || /[/+]json$/.test(type)) return 'json';
    if (/^([cm]?js|javascript)$/.test(extension) || /\/(x-)?javascript$/.test(type)) return 'javascript';
    return '';
  }
  function highlightCode(text, language) {
    language = codeLanguage(language);
    if (!language) return escape(text);
    let tokens = 0;
    const span = (kind, value) => { tokens++; return '<span class="syntax-' + kind + '">' + escape(value) + '</span>'; };
    const pattern = language === 'html'
      ? /<!--[\s\S]*?(?:-->|$)|<![^<>]*>|<\/?[a-zA-Z][^<>]*>/g
      : /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\])*"?|'(?:\\[\s\S]|[^'\\])*'?|`(?:\\[\s\S]|[^`\\])*`?|\b(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b|[a-zA-Z_$][\w$]*/g;
    let output = '', start = 0;
    for (const match of text.matchAll(pattern)) {
      const token = match[0];
      output += escape(text.slice(start, match.index));
      let kind = '';
      if (language === 'html') {
        if (token.startsWith('<!--')) output += span('comment', token);
        else {
          let offset = 0;
          for (const part of token.matchAll(/"[^"]*"|'[^']*'|[a-zA-Z_:][\w:.-]*/g)) {
            if (tokens >= 4096) return escape(text);
            output += escape(token.slice(offset, part.index));
            output += span(part.index <= 2 ? 'tag' : /^["']/.test(part[0]) ? 'string' : 'key', part[0]);
            offset = part.index + part[0].length;
          }
          output += escape(token.slice(offset));
        }
      } else {
        if (token.startsWith('//') || token.startsWith('/*')) kind = 'comment';
        else if (/^["'`]/.test(token)) kind = language === 'json' && /^\s*:/.test(text.slice(match.index + token.length)) ? 'key' : 'string';
        else if (/^\d/.test(token)) kind = 'number';
        else if (/^(true|false|null)$/.test(token)) kind = 'keyword';
        else if (language === 'javascript' && /^(async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|undefined|var|void|while|yield)$/.test(token)) kind = 'keyword';
        output += kind ? span(kind, token) : escape(token);
      }
      if (tokens > 4096) return escape(text);
      start = match.index + token.length;
    }
    return output + escape(text.slice(start));
  }
  function inline(text, depth = 0) {
    if (depth > 8) return escape(text);
    const pattern = /`([^`\n]+)`|(!?)\[([^\[\]\n]*)\]\(([^\s()]*)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~/g;
    let output = '', start = 0;
    for (const match of text.matchAll(pattern)) {
      output += escape(text.slice(start, match.index));
      const [raw, code, image, label, href, bold1, bold2, em1, em2, strike] = match;
      if (code !== undefined) output += '<code>' + escape(code) + '</code>';
      else if (label !== undefined) {
        output += !image && /^(https?:\/\/|mailto:|#)/i.test(href)
          ? '<a target="_blank" rel="noopener noreferrer" href="' + escape(href) + '">' + inline(label, depth + 1) + '</a>'
          : escape(raw);
      } else {
        const tag = bold1 || bold2 ? 'strong' : strike ? 'del' : 'em';
        output += '<' + tag + '>' + inline(bold1 || bold2 || em1 || em2 || strike, depth + 1) + '</' + tag + '>';
      }
      start = match.index + raw.length;
    }
    return output + escape(text.slice(start));
  }
  function renderMarkdown(text, depth = 0) {
    if (depth > 8) return '<pre>' + escape(text) + '</pre>';
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const plain = () => '<p class="preview-note">Formatting simplified for this large document.</p><pre>' + escape(text) + '</pre>';
    if (lines.length > 4096) return plain();
    let output = '', paragraph = [], list = '';
    const flush = () => {
      if (paragraph.length) output += '<p>' + inline(paragraph.join('\n')) + '</p>';
      paragraph = [];
      if (list) output += '</' + list + '>';
      list = '';
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      const heading = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/);
      const item = line.match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/);
      if (fence) {
        flush();
        const code = [], close = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}\\s*$');
        while (++i < lines.length && !close.test(lines[i])) code.push(lines[i]);
        output += '<pre><code>' + highlightCode(code.join('\n'), fence[2].trim()) + '</code></pre>';
      } else if (heading) {
        flush();
        const title = (heading[2] || '').trim().replace(/(?:^|[ \t])#+$/, '').trimEnd();
        output += '<h' + heading[1].length + '>' + inline(title) + '</h' + heading[1].length + '>';
      } else if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        flush(); output += '<hr>';
      } else if (/^ {0,3}>/.test(line)) {
        flush(); const quote = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^ {0,3}> ?/, ''));
        i--;
        output += '<blockquote>' + renderMarkdown(quote.join('\n'), depth + 1) + '</blockquote>';
      } else if (item) {
        const tag = item[1] ? 'ul' : 'ol';
        if (paragraph.length || list !== tag) { flush(); output += '<' + tag + '>'; list = tag; }
        output += '<li>' + inline(item[2]) + '</li>';
      } else if (!line.trim()) flush();
      else { if (list) flush(); paragraph.push(line); }
    }
    flush();
    return output.split('<', 8194).length > 8193 ? plain() : output;
  }
  return { inferContentType, previewKind, renderMarkdown, codeLanguage, highlightCode };
}
