# QR codes for nearby play (no internet)

- `qrcode.min.js` draws a QR code: QR Code Generator for JavaScript 1.4.4 by Kazuhiko Arase
  (MIT), from the `qrcode-generator` npm package, minified.
- `jsqr.min.js` reads a QR code from the camera: jsQR 1.4.0 (Apache License 2.0, see
  `LICENSE-jsqr.txt`), from the `jsqr` npm package, minified.

Both are loaded only when someone uses nearby play (`public/core/nearby.js`).
