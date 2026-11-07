// Reading a calibration label's code (Data Matrix: the Tool ID - the desktop's
// labels.py / datamatrix.py) from a picture: the camera's, in Scan a Label.
// The phone's own reader where it has one (Android's Chrome: BarcodeDetector);
// otherwise ZXing (zxing.min.js: @zxing/library 0.21.3, Apache 2.0 -
// zxing-LICENSE.txt), loaded the first time it's needed. ZXing's web reader
// misses a code turned more than a few degrees, so a picture it can't read is
// tried again turned a little each way; and it looks for the code from the
// picture's middle out, so a small one (the phone held back, to focus) is
// tried again in a tighter area round the middle. Nothing here touches the
// screen, so tests can run it in a browser on its own.
"use strict";

const Scan = (() => {
  const TURNS = [0, 8, -8, 16, -16, 24, -24, 32, -32];     // degrees: straight first
  const AREAS = [1, 0.55];                                  // the whole picture, then its middle part

  let native;                   // the phone's own reader, false (none), or undefined (not looked for yet)
  async function nativeReader() {
    if (native !== undefined) return native;
    native = false;
    try {
      if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("data_matrix"))
        native = new BarcodeDetector({ formats: ["data_matrix"] });
    } catch (e) { /* (no reader: ZXing it is) */ }
    return native;
  }

  let loading;
  function loadZxing() {
    if (typeof ZXing !== "undefined") return Promise.resolve();
    loading = loading || new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "zxing.min.js";
      script.onload = resolve;
      script.onerror = () => { loading = null; reject(new Error("The code reader couldn't be loaded.")); };
      document.head.append(script);
    });
    return loading;
  }

  let zx, turned;
  function zxingRead(picture) {
    zx = zx || { reader: new ZXing.DataMatrixReader(), hints: new Map([[ZXing.DecodeHintType.TRY_HARDER, true]]) };
    turned = turned || document.createElement("canvas");
    for (const area of AREAS) {
      // (the middle part: enlarged to the same size, so its squares are bigger to find)
      const side = Math.round(Math.min(picture.width, picture.height) * area);
      const sx = (picture.width - side) / 2, sy = (picture.height - side) / 2;
      const w = area < 1 ? Math.min(picture.width, side * 2) : picture.width;
      const h = area < 1 ? w : picture.height;
      turned.width = w;
      turned.height = h;
      const g = turned.getContext("2d", { willReadFrequently: true });
      for (const angle of TURNS) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = "#cccccc";
        g.fillRect(0, 0, w, h);
        g.translate(w / 2, h / 2);
        g.rotate(angle * Math.PI / 180);
        if (area < 1) g.drawImage(picture, sx, sy, side, side, -w / 2, -h / 2, w, h);
        else g.drawImage(picture, -w / 2, -h / 2);
        try {
          const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(turned)));
          return zx.reader.decode(bitmap, zx.hints).getText();
        } catch (e) { /* (not found this way: the next turn) */ }
      }
    }
    return null;
  }

  // The code's text in a picture (a canvas), or null when there's none to read
  async function read(picture) {
    const reader = await nativeReader();
    if (reader) {
      try {
        const found = await reader.detect(picture);
        if (found.length) return found[0].rawValue;
      } catch (e) { /* (fall back to ZXing) */ }
    }
    await loadZxing();
    return zxingRead(picture);
  }

  // (for the tests: ZXing only, as on an iPhone)
  async function readWithZxing(picture) {
    await loadZxing();
    return zxingRead(picture);
  }

  return { read, readWithZxing, loadZxing };
})();
