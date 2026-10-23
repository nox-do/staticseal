import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';

const readonly = names => Object.fromEntries(names.split(' ').map(name => [name, 'readonly']));

export default [
  {
    ignores: [
      'index.html',
      'fatseal.html',
      'src/logo.mjs',
      'src/wrapper-template.mjs',
      'src/reader-factories.mjs',
      'src/srcset-parser.mjs'
    ]
  },
  {
    files: ['**/*.{js,mjs}', 'src/app.html'],
    plugins: { html },
    languageOptions: { ecmaVersion: 2022 },
    rules: js.configs.recommended.rules
  },
  {
    files: ['src/**/*.{js,mjs}', 'src/app.html', 'test/*-smoke-runner.js'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['bin/**/*.mjs', 'scripts/**/*.mjs', 'test/**/*.mjs', '*.config.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/app.html'],
    // These modules are inserted at build markers inside the creator's scope.
    languageOptions: {
      globals: readonly(
        'createFormat createPreview createCrypto createPageViewer preparePackage inflateContent isHtmlFile renderWrapper BROWSER_FILE_MAX_BYTES BROWSER_FILE_WARN_BYTES BROWSER_FILE_CONFIRM_BYTES'
      )
    }
  },
  {
    files: ['src/reader.js'],
    languageOptions: { globals: readonly('STATICSEAL_FORMAT STATICSEAL_VIEWER STATICSEAL_DECODER STATICSEAL_RESTORE') }
  },
  {
    files: ['src/multi-file-ui.js'],
    // This fragment shares the creator scope; sealSelection is called at a build marker.
    languageOptions: {
      globals: readonly(
        '$ sourceFile htmlPageOption htmlPage button fileMeta inferContentType formatBytes setStatus password passwordRepeat encryptBytes DEFAULT_ITERATIONS outputFilenameFor renderWrapper downloadHtml BROWSER_FILE_MAX_BYTES BROWSER_FILE_WARN_BYTES BROWSER_FILE_CONFIRM_BYTES inspectHtmlSelection embedSelectedHtml packCollection'
      )
    },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^sealSelection$' }] }
  }
];
