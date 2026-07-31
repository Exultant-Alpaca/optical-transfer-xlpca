# Third-party notices

This file separates the code of this project from the other software that it contains, and from the projects that it used as references. `package-lock.json` gives the version of each package. The `LICENSE` file applies only to the code in this repository. It does not change the license of other software.

## Software in this project

| Project | Function | Version | License | Source |
| --- | --- | --- | --- | --- |
| React and React DOM | The interface | 19.2.8 | MIT | [Repository](https://github.com/facebook/react) |
| Vite | The build | 8.2.0 | MIT | [Repository](https://github.com/vitejs/vite) |
| TypeScript | Types and compilation | 7.0.2 | Apache-2.0 | [Repository](https://github.com/microsoft/TypeScript) |
| Vitest | The tests | 4.1.10 | MIT | [Repository](https://github.com/vitest-dev/vitest) |
| zxing-wasm | It reads and writes the QR codes | 3.1.2 | MIT | [Repository](https://github.com/Sec-ant/zxing-wasm) |
| ZXing C++ | The QR code software in zxing-wasm | in zxing-wasm | Apache-2.0 | [Repository](https://github.com/zxing-cpp/zxing-cpp) |
| Zint | The code writer in zxing-wasm | in zxing-wasm | BSD-3-Clause | [Repository](https://github.com/zint/zint) |
| QRStatic | The WebAssembly transport of the demonstration page | revision `301c2f0c` | MIT | [Repository](https://github.com/ianzepp/qrstatic) |

Each package keeps its own license text in its own files. Read those files before you give a build to other persons.

## Projects used as references

These projects gave ideas for the design. This release does not contain files from them. Their licenses are here, so that a person can examine them before a future change uses their code.

| Project | Use as a reference | License | Source |
| --- | --- | --- | --- |
| Decimen Optical Transfer | Screen to camera transfer, fountain code, frame times | MIT | [Repository](https://github.com/bashalarmistalt/decimen-optical-transfer) |
| Airgapped QR Code Transfer | The sequence of operations, the name of the file, compression, download | MIT | [Repository](https://github.com/mohankumarelec/airgapped-qr-code-transfer) |
| TXQR | Moving QR codes and the fountain code | MIT | [Repository](https://github.com/divan/txqr) |
| libcimbar | Colour codes with more data, for the future | MPL-2.0 | [Repository](https://github.com/sz3/libcimbar) |

## What is new and what is not

This release contains the zxing-wasm software, and QRStatic for the demonstration page. The Quick QR fountain code is new TypeScript. The public behaviour and the documents of the projects above gave the ideas for it. It is not a translation of their code. If a future change copies or adapts other code, keep the copyright and the license of that project in the file, and make this document current before the release.
