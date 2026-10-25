import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';

const readonly = names => Object.fromEntries(names.split(' ').map(name => [name, 'readonly']));

export default [
  {
    ignores: [
      'index.html',
      'examples/**/sealed.html',
      'examples/html/sealed-*.html',
      'src/logo.mjs',
      'src/wrapper-template.mjs',
      'src/reader-factories.mjs',
      'src/srcset-parser.mjs'
    ]
  },
  {
    files: ['**/*.{js,mjs}', 'src/app.html', 'examples/html/**/*.html'],
    plugins: { html },
    languageOptions: { ecmaVersion: 2022 },
    rules: js.configs.recommended.rules
  },
  {
    files: ['src/**/*.{js,mjs}', 'src/app.html', 'test/*-smoke-runner.js', 'examples/html/**/*.html'],
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['bin/**/*.mjs', 'scripts/**/*.mjs', 'test/**/*.mjs', '*.config.mjs'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/app.html'],
    // Referenced by the selection UI inserted into this same scope.
    rules: {
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern:
            '^(fileMeta|htmlPageOption|htmlPage|button|DEFAULT_ITERATIONS|setStatus|outputFilenameFor|formatBytes|encryptBytes|downloadHtml)$'
        }
      ]
    },
    // These modules are inserted at build markers inside the creator's scope.
    languageOptions: {
      globals: readonly(
        'selectFiles sealSelection toBase64 createFormat createFileTypes createPreview createCrypto createPageViewer preparePackage inflateContent isHtmlFile renderWrapper SOURCE_MAX_BYTES HTML_MAX_BYTES BROWSER_FILE_WARN_BYTES BROWSER_FILE_CONFIRM_BYTES'
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
        '$ sourceFile htmlPageOption htmlPage button fileMeta inferContentType formatBytes setStatus password passwordRepeat encryptBytes DEFAULT_ITERATIONS outputFilenameFor renderWrapper downloadHtml SOURCE_MAX_BYTES PREPARED_MAX_BYTES BROWSER_FILE_WARN_BYTES BROWSER_FILE_CONFIRM_BYTES inspectHtmlSelection embedSelectedHtml packCollection'
      )
    },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^sealSelection$' }] }
  }
];
