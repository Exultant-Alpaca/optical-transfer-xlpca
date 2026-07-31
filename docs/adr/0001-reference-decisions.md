# ADR 0001: Other software and references

## Status

Accepted for the open-source release.

## Decisions

### Decimen Optical Transfer and TXQR: references for the protocol

Use the public ideas of these projects: the fountain code, the same sequence on the two ends, the recovery
from frames in a different sequence, the operation of the camera, and the schedule of the frames. The
TypeScript fountain code in this project is new. It does not contain files from these projects.
`THIRD_PARTY_NOTICES.md` gives the links and the licenses.

### Airgapped QR Code Transfer: a reference for the sequence of operations

Use the public ideas of the sequence: the selection of any file, the name of the file, the compression on
the device, and the separate pages to send and to receive. Do not copy its blocks, its use of a content
network, or its files.

### QRStatic: a demonstration only

Use the QRStatic Rust dependency at a given revision and make a small WebAssembly module from it. Do not
give it as a transfer mode. The measurements in `native/qrstatic-wasm/` show that the decoder fails with
one pixel of movement, one frame of offset, or a small blur. A camera makes all of these conditions
continuously. Thus the project shows it as a demonstration in the browser and records the limits in
`docs/qrstatic-notes.md`. Keep the license of QRStatic separate.

### zxing-wasm, ZXing C++, and Zint: the QR software

Keep the QR files on the same server through `zxing-wasm`. Its ZXing C++ and Zint parts keep their own
licenses. Do not put them in the MIT license of this project.

### libcimbar: a reference only

Record libcimbar as a reference for colour codes with more data. This project does not compile it, contain
it, or copy it. Its MPL-2.0 license stays separate.

### Passphrase mode: encryption on the device

Give a Passphrase mode with the Quick QR mode. Make an AES-GCM-256 key in each browser with
PBKDF2-HMAC-SHA-256. Use the random transfer number as the salt. Encrypt each group with a new nonce. Do
not send the phrase and do not add a return path. Keep the label for a demonstration, because a person who
sees the sending screen can read the phrase, and because no specialist examined the code.

## Results

The project stays small. A person can host it and examine it. Quick QR is the usual mode. Passphrase is an
optional mode for secrecy. QRStatic is a demonstration of a transport that a lens stops. Colour codes with
more data are not part of this release.
