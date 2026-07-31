# Third-party notices

This file separates the original code in this repository from third-party software and reference projects. The project `LICENSE` applies only to original project code. It does not replace a third-party license.

## Software included in the browser build

| Project | Function | Version | License | License copy | Source |
| --- | --- | --- | --- | --- | --- |
| React and React DOM | User interface | 19.2.8 | MIT | [React-MIT.txt](public/licenses/React-MIT.txt) | [Repository](https://github.com/facebook/react) |
| zxing-wasm | QR code reader and writer | 3.1.2 | MIT | [zxing-wasm-MIT.txt](public/licenses/zxing-wasm-MIT.txt) | [Repository](https://github.com/Sec-ant/zxing-wasm) |
| ZXing C++ | QR code software embedded in zxing-wasm | bundled with zxing-wasm | Apache-2.0 | [Apache-2.0.txt](public/licenses/Apache-2.0.txt) | [Repository](https://github.com/zxing-cpp/zxing-cpp) |
| Zint backend | Code writer embedded through zxing-wasm | bundled with zxing-wasm | BSD-style backend terms | [Zint-LICENSE.txt](public/licenses/Zint-LICENSE.txt) | [Repository](https://github.com/zint/zint) |
| QRStatic | WebAssembly transport on the demonstration page | revision `301c2f0c165790f0981426dff1af830670f5d456` | MIT, as declared in the upstream README | [QRStatic-MIT.txt](public/licenses/QRStatic-MIT.txt) | [Pinned source](https://github.com/ianzepp/qrstatic/tree/301c2f0c165790f0981426dff1af830670f5d456) |

The Zint root license says that its backend and shared library use BSD terms. It says that its frontends and Qt4 backend remain under the GPL. This project does not intentionally include the Zint frontends or Qt code.

The pinned QRStatic revision declares `MIT` in its README, but it does not contain a separate `LICENSE` or `NOTICE` file. The deployed notice records that fact and reproduces the standard MIT terms. The strongest way to remove this ambiguity is to obtain a complete notice from the QRStatic maintainer. Do not replace the pinned revision without checking its license files again.

The deployed build includes readable copies of these notices in [`public/licenses`](public/licenses). The site links to that directory from its Source page.

## Build and test tools

These packages build or test the project. They are not intentionally included in the static browser output. Their exact versions are in `package-lock.json`.

| Project | Function | Version | License | Source |
| --- | --- | --- | --- | --- |
| Vite | Build tool | 8.2.0 | MIT | [Repository](https://github.com/vitejs/vite) |
| TypeScript | Type checking and compilation | 7.0.2 | Apache-2.0 | [Repository](https://github.com/microsoft/TypeScript) |
| Vitest | Tests | 4.1.10 | MIT | [Repository](https://github.com/vitest-dev/vitest) |

## Projects used as references

These projects informed the design. This release does not contain their files. A future change that copies or adapts their code must preserve the applicable notices and update this document.

| Project | Use as a reference | License | Source |
| --- | --- | --- | --- |
| Decimen Optical Transfer | Screen-to-camera transfer, fountain codes, and frame timing | MIT | [Repository](https://github.com/bashalarmistalt/decimen-optical-transfer) |
| Airgapped QR Code Transfer | Transfer flow, file metadata, compression, and download | MIT | [Repository](https://github.com/mohankumarelec/airgapped-qr-code-transfer) |
| TXQR | Animated QR codes and fountain codes | MIT | [Repository](https://github.com/divan/txqr) |
| libcimbar | Higher-density colour codes as a future reference | MPL-2.0 | [Repository](https://github.com/sz3/libcimbar) |

## Original implementation

This release includes `zxing-wasm` and QRStatic. The Quick QR fountain-code implementation is original TypeScript informed by the public behaviour and documentation of the reference projects. It is not a translation of their source code.
