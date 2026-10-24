# Third-party notices

## Srcset parser

`src/srcset-parser.mjs` is derived from the srcset parser in SingleFile Core,
commit `3fe510c2f28ecb552f125fe9849a8a0f0c2d3213`, itself derived from
[Alex Bell’s parse-srcset](https://github.com/albell/parse-srcset).
The upstream source credits Gildas Lormeau and Alex Bell.

License: [MIT — full notice](third-party/srcset-parser.LICENSE.txt).
Only this MIT-licensed parser is included, not the AGPL-licensed SingleFile core.
Local adaptations retain ambiguous candidates when rewriting resource references.

The parser follows the HTML srcset parsing algorithm. Its source comments explain
the parsing steps; these implementation comments are omitted from the build.
The standalone creator includes the full license notice in compact form because
it is distributed independently of this repository. Generated readers do not
include this parser.

## npm dependencies

CLI and development dependencies are listed in `package.json`, with exact resolved
versions in `package-lock.json`. Their license files remain in the installed
packages. They are not bundled into the standalone HTML creator or readers.
