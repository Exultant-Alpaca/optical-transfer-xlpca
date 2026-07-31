# Optical Transfer Demo

Send a file between two devices with a screen and a camera.

The first device shows the file as QR codes. The second device reads the QR codes with its camera. It then
assembles the file in the browser. There is no server, no upload address, no account, and no network
between the two devices.

This is a demonstration. Send one file at a time. The maximum size is 10 MB. The link is slow. A large file
takes minutes.

> The text in this repository and on the site follows ASD-STE100 Simplified Technical English.

## How to start

You need Node.js 22 or a later version. You also need a browser with a camera.

```sh
npm ci
npm run dev
```

Open the Send page on one device. Open the Receive page on a second device. The camera needs an HTTPS
address or `localhost`.

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` writes the static files to `dist/`. Put these files on an HTTPS server. Send the index page
for unknown paths. Keep the header rules from `public/_headers`, or use the equivalent rules of your
server. These rules let the local WebAssembly files start.

To build for a subdirectory:

```sh
VITE_BASE_PATH=/transfer/ npm run build
```

Set `VITE_PUBLIC_URL` only if the link for the receiver must point to a different address.

## Vercel

This repository includes `vercel.json`. It sets the Vite build command, uses `dist/` as the output, sends
the client-side routes to `index.html`, and applies the same security headers as `public/_headers`.

From the repository root:

```sh
npx vercel
npx vercel --prod
```

The Vercel project must use the repository root as its Root Directory. Camera access still needs HTTPS.

## Modes

- **Quick QR.** The sender divides the file and sends it as a fountain code. Each frame is a QR code with
  a CRC32 check. The receiver can lose frames, read frames two times, or read frames in a different
  sequence, and it can still assemble the file. This mode does not encrypt the file.
- **Passphrase.** The same data, but encrypted with AES-GCM-256. The two browsers make the key with
  PBKDF2-HMAC-SHA-256 from a phrase of 8 parts. The first device shows the phrase. The user types the
  phrase on the second device. The software does not put the phrase in the frames.

No mode identifies the other device. A person who sees the sending screen can read the phrase. No
specialist examined the security of this software. Keep a second copy of each file that you send.

## Speed

There are three speeds:

| Speed | Bytes in each frame | Frames each second | Data rate |
| --- | --- | --- | --- |
| Compatibility | 720 | 6 | 4 kB/s |
| Balanced | 900 | 8 | 7 kB/s |
| High density | 2,896 | 20 | 57 kB/s |

High density mode uses the maximum quantity of data that a QR code can hold. This needs a version 38
symbol, which is 169 modules wide. Thus each module is smaller on the screen, and the camera must be
nearer and more still.

One QR code needs 20 ms to 60 ms to make. Thus the sender makes the QR codes in parallel workers and keeps
them in a queue. The paint loop then only copies pixels. The sending screen shows the speed that it gets.

The camera is the limit, not the sender. A camera that reads 30 frames each second cannot use more frames
than that. A higher rate made the display worse in tests, so the sender holds each dense frame for 50 ms.

## GIF files

The sending screen can write its QR codes to a GIF file. The QRStatic page can write its window of 64
frames to a GIF file. Use these files to examine or to send a stream. They are not more quick: most
programs that show a GIF make it more slow than the sender. A GIF must hold a full stream, so this function
is available only for a stream of 300 frames or less.

## QRStatic demonstration

The page at `/qrstatic` shows a third transport, [QRStatic](https://github.com/ianzepp/qrstatic). It hides
a QR code in 64 frames of noise. The page encodes and decodes the data in the browser.

QRStatic is not a transfer mode, because a camera cannot read it. The codec moves each cell of the frame to
a different position in each frame. Thus it needs the same pixel positions and the same frame sequence that
the encoder made. One pixel of movement, one frame of offset, or a small blur stops the decode.

Tests measure this. A smaller quantity of data in each frame does not help. A lower frame rate does not
help. Larger cells do help against the blur, but the format has no marks for position and no frame numbers.
Thus the receiver still cannot align the data. See [docs/qrstatic-notes.md](docs/qrstatic-notes.md).

## Structure

```
src/protocol/    frames, fountain code, encryption, assembly
src/services/    QR codes, GIF files, local file operations
src/workers/     QR encode, QR decode, and file operations off the UI thread
src/routes/      the Send, Receive, QRStatic, and information pages
native/          the Rust code that becomes the QRStatic WebAssembly module
docs/            the protocol, the architecture, and the limits
```

The QRStatic WebAssembly module is in the repository. Thus a build does not need a Rust toolchain. Set
`QRSTATIC_REBUILD=1` to make the module again. This needs cargo and the `wasm32-unknown-unknown` target.

## Credits

These projects gave the ideas for the design. This release does not contain their files, and the fountain
code here is new TypeScript. But the ideas came first, and the projects must get the credit:

- [Decimen Optical Transfer](https://github.com/bashalarmistalt/decimen-optical-transfer), MIT. Screen to
  camera transfer in a browser, the fountain code, and the frame times. This is the nearest example of the
  same idea.
- [Airgapped QR Code Transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer), MIT. The
  sequence of operations, the name of the file, the compression, and the download.
- [TXQR](https://github.com/divan/txqr), MIT. Moving QR codes with a fountain code.
- [libcimbar](https://github.com/sz3/libcimbar), MPL-2.0. Colour codes with more data in each frame.

[QRStatic](https://github.com/ianzepp/qrstatic) supplies the transport of the demonstration page.
[zxing-wasm](https://github.com/Sec-ant/zxing-wasm) reads and writes the QR codes.

## Licenses

The MIT license applies to the code in this repository. It does not apply to the other software that this
project uses. Read [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before you release a build.
