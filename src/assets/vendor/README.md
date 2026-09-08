# Vendored third-party code

Files here are copied into the repo on purpose rather than pulled from a CDN at
runtime. A CDN request tells someone else's server which page you loaded and
when, and that is exactly the thing this project is trying not to do.

## zxing.min.js

- Source: [`@zxing/library`](https://github.com/zxing-js/library) v0.21.3, `umd/index.min.js`
- Licence: MIT
- Why: decodes barcodes in browsers without the native `BarcodeDetector` API
  (Safari, Firefox). It is loaded on demand the first time you open the scanner
  in one of those browsers, not on page load.

To update it:

```bash
npm install --no-save @zxing/library@<version>
cp node_modules/@zxing/library/umd/index.min.js src/assets/vendor/zxing.min.js
```
