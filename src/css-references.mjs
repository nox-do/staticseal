// Shared conservative CSS token grammar. Callers own resolution and unsupported-syntax warnings.
export function cssReferencePattern() {
  return /\/\*[\s\S]*?\*\/|@import\b(?:\s|\/\*[\s\S]*?\*\/)*(["'])(.*?)\1|(?:@import\b(?:\s|\/\*[\s\S]*?\*\/)*)?\burl\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)|\b(?:-webkit-)?image-set\s*\(|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;
}
