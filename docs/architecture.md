# Architecture

## Limits of the system

This application is a static browser project. A server sends the HTML, the JavaScript, the CSS, and the
local WebAssembly files. The selected file, the camera frames, the transfer frames, and the assembled file
stay in the two browsers.

## Parts

- React and TypeScript make the pages and the controls.
- `zxing-wasm` reads and writes the QR codes.
- `qrstatic` is a Rust dependency at a given revision. The build makes
  `public/wasm/qrstatic_temporal.wasm` from it for the demonstration page.
- `fileProcessor.worker.ts` compresses the file, makes a photo smaller if necessary, and calculates the
  SHA-256 value.
- `qrEncoder.worker.ts` makes the QR codes. One QR code needs 20 ms to 60 ms. Thus
  `services/qrFrameSource.ts` operates a group of these workers and keeps a queue. The paint loop then only
  copies pixels to a canvas.
- `qrDecoder.worker.ts` decodes the camera frames. Thus the interface does not stop.
- `qrstaticDecoder.worker.ts` decodes one window of noise frames for the demonstration page.
- `services/gif.ts` writes the GIF89a format. Thus a GIF export needs no other software.
- `sw.js` keeps the static files and examines the WebAssembly files again after a new release.

## Sequence of operations

```text
select the file
  -> the file worker prepares the bytes and calculates the SHA-256 value
  -> Quick QR: fountain blocks -> binary frame -> QR encoder
  -> Passphrase: PBKDF2 key -> AES-GCM groups -> fountain blocks -> binary frame -> QR encoder
  -> the camera of the second device -> the decoder worker
  -> examine the frame -> assemble the fountain blocks
  -> decompress -> examine the SHA-256 value
  -> the user saves or sends the file
```

## Design limits

The optical link has no return path. Thus the sender repeats frames without a limit, and the receiver can
lose frames, read frames two times, or read frames in a different sequence. Each transfer has a random
128-bit number. Thus the receiver can ignore the frames of a different transfer. It can also start again
when the sender starts again.

The two ends combine the source blocks as 32-bit words. Thus each speed uses a block size that divides by
4, and the frame parser refuses a different block size before it allocates memory.

Quick QR is the usual mode. QRStatic is not a transfer mode. Its decoder needs the same pixel positions and
the same frame sequence that the encoder made, and no camera can give these. Thus it operates only on the
demonstration page. See `qrstatic-notes.md`.

Passphrase mode makes the key and encrypts the data in the two browsers. The transfer number is public and
is also the salt for the key. The phrase does not go into the frames. This mode keeps the file secret from
a person who does not know the phrase. It does not identify the two devices. It also does not hide the
phrase from a person who sees the sending screen.
