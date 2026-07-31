# How to contribute

Small changes are welcome. This project stays a demonstration. Do not add an upload service, telemetry, or
accounts.

## Checks

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The QRStatic code has its own tests. These tests need a Rust toolchain:

```sh
cd native/qrstatic-wasm
cargo test --release --target "$(rustc -vV | sed -n 's/host: //p')"
```

## Rules

- Write all text in ASD-STE100 Simplified Technical English. Use one instruction in each sentence. Use the
  active voice. Use a maximum of 20 words in a procedural sentence.
- Record each change of the data format in `docs/protocol.md`. Also add a decision record in `docs/adr/`.
- Test each change to the camera or the QR codes. Use one computer to send and one telephone to receive.
  Use an HTTPS address. Give the result that the equipment showed, not the best result that you saw.
- Give measured values, not target values. The sending screen shows its true frame rate for this reason.
- Examine the license before you add other software. Keep its notices. Then make `THIRD_PARTY_NOTICES.md`
  current.
