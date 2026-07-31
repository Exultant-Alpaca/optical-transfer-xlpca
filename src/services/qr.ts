import { prepareZXingModule, writeBarcode } from "zxing-wasm/writer";

let configured = false;

function configureWriter(): void {
  if (configured) return;
  configured = true;
  // self.location works on the main thread and inside a worker; window does not.
  const wasmBaseUrl = new URL("wasm/", new URL(import.meta.env.BASE_URL, self.location.origin)).toString();
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => path.endsWith(".wasm") ? `${wasmBaseUrl}${path}` : `${prefix}${path}` } });
}

export interface QrSymbol {
  /** One byte per module: 0 is dark, 255 is light. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * The raw module grid, quiet zone included, one byte per module. Encoding a PNG
 * and decoding it back through an <img> costs more than the QR encode itself,
 * so the animated sender paints this straight onto a canvas instead.
 */
export async function writeQrSymbol(value: string | Uint8Array): Promise<QrSymbol> {
  configureWriter();
  const result = await writeBarcode(value, { format: "QRCode", options: "ecLevel=L", scale: 1, addQuietZones: true });
  if (!result.symbol) throw new Error(result.error || "QR writer did not return a symbol");
  return result.symbol;
}

export async function writeQr(value: string | Uint8Array): Promise<Blob> {
  configureWriter();
  const result = await writeBarcode(value, { format: "QRCode", options: "ecLevel=L", scale: 4, addQuietZones: true });
  if (!result.image) throw new Error("QR writer did not return an image");
  return result.image;
}

/** Expands a one-channel symbol into canvas pixels. */
export function symbolToImageData(symbol: QrSymbol): ImageData {
  const pixels = new Uint8ClampedArray(symbol.width * symbol.height * 4);
  for (let index = 0; index < symbol.data.length; index += 1) {
    const value = symbol.data[index]!;
    const offset = index * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = 255;
  }
  return new ImageData(pixels, symbol.width, symbol.height);
}
