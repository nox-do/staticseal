// CLI-only: no theme parser or extra runtime code in the browser app.
export function themeStyle(theme = {}) {
  const declarations = [];
  for (const [name, property] of Object.entries({
    bg: '--bg', text: '--ink', accent: '--accent', panel: '--panel'
  })) {
    const value = theme[name];
    if (value === undefined) continue;
    if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
      throw new Error(`--theme-${name} requires a hex color, e.g. "#27665d".`);
    }
    declarations.push(`${property}:${value}`);
    if (name === 'text') declarations.push(`--muted:${value}`);
    if (name === 'accent') declarations.push(`--accent-strong:${value}`);
  }
  if (theme.font !== undefined) {
    // Font stacks only; no declarations, URLs, HTML or external font loading.
    if (!/^(?:[a-zA-Z][\w -]*|"[a-zA-Z][\w -]*"|'[a-zA-Z][\w -]*')(?:\s*,\s*(?:[a-zA-Z][\w -]*|"[a-zA-Z][\w -]*"|'[a-zA-Z][\w -]*'))*$/.test(theme.font)) {
      throw new Error('--theme-font requires a font-family stack, e.g. "Georgia, serif".');
    }
    declarations.push(`font-family:${theme.font}`);
  }
  let radius = '';
  if (theme.radius !== undefined) {
    if (!/^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em))$/.test(theme.radius)) {
      throw new Error('--theme-radius requires a nonnegative length in px, rem or em, or 0.');
    }
    radius = `.lock-shell{border-radius:${theme.radius}}`;
  }
  return (declarations.length ? `body:not(.vp){${declarations.join(';')}}` : '')
    + (theme.accent !== undefined ? 'body:not(.vp) :focus-visible{outline-color:var(--accent)}' : '') + radius;
}
