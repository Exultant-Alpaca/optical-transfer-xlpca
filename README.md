# Optical Transfer Demo

Send a file directly between two devices using a screen and a camera.

The sender displays the file as animated QR codes. The receiver scans the codes and rebuilds the file in
the browser. No server, account, or network connection between the devices is required.

This is an experimental project for files up to 10 MB. Transfers are slow, especially for large files.

[Try the live demo](https://optical-transfer-xlpca.vercel.app/)

## Run locally

You need Node.js 22 or later and a browser with a camera.

```sh
npm ci
npm run dev
```

Open **Send** on one device and **Receive** on the other. Camera access requires HTTPS or `localhost`.

Run the checks and build:

```sh
npm run typecheck
npm test
npm run build
```

The build writes the site to `dist/`.

## Transfer modes

- **Quick QR:** Fast and simple. The file is not encrypted.
- **Passphrase:** The sender shows a phrase, and the receiver types it. The file is encrypted with
  AES-GCM before it is sent.

Passphrase mode does not identify the other device. Anyone who can see the sender's screen may see the
phrase. This project has not had an independent security review.

## Speed settings

- **Compatibility:** Most reliable with difficult cameras or screens.
- **Balanced:** The default setting for general use.
- **High density:** Sends more data per QR code, but needs a steady camera and clear image.

## Media compression

The sender can optionally reduce large photos, animated GIFs, and videos before transmission. Processing
stays in the browser. The original is used when the browser lacks a required codec or the new file is not
at least 10% smaller. Video compression runs in real time and supports videos up to five minutes.

## QRStatic

The `/qrstatic` page is a separate experiment based on [QRStatic](https://github.com/ianzepp/qrstatic).
It hides a QR code across a sequence of noise frames. It needs stable timing and is not part of the main
file-transfer flow.

## Deploy with Vercel

The repository includes `vercel.json` for the Vite build, static output, client-side routes, and security
headers.

From the repository root:

```sh
npx vercel
npx vercel --prod
```

Use the repository root as the Vercel Root Directory.

## Credits

This project was informed by:

- [Decimen Optical Transfer](https://github.com/bashalarmistalt/decimen-optical-transfer), MIT
- [Airgapped QR Code Transfer](https://github.com/mohankumarelec/airgapped-qr-code-transfer), MIT
- [TXQR](https://github.com/divan/txqr), MIT
- [libcimbar](https://github.com/sz3/libcimbar), MPL-2.0
- [QRStatic](https://github.com/ianzepp/qrstatic)
- [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)

The code in this repository is licensed under MIT. Third-party software keeps its own license. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) before releasing a build.
