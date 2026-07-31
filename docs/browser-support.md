# Browsers

The target browsers are these: the current Safari on iPhone and iPad, the current Chrome on Android, and
the current Chrome, Edge, and Safari on a computer.

The sender needs a file selector, Web Crypto (with PBKDF2 and AES-GCM for Passphrase mode), and Canvas.
Screen Wake Lock is optional. The receiver needs an HTTPS address or a different secure address,
`getUserMedia`, a rear camera, Canvas, and WebAssembly. The receiver uses `requestVideoFrameCallback` if it
is available. If it is not available, the receiver uses `requestAnimationFrame`.

The application uses zxing-wasm and not the `BarcodeDetector` interface, because browsers do not agree
about that interface. If the camera is not available, the application gives the reason. It does not use the
network to send the file.

This list is a target. It is not a certification for a given device. Do a test before you release the
software. Test these conditions: a bright room, a dark room, different distances, different angles, the
automatic focus, a rotated device, a page in the background, a locked screen, a slow device, and files of
1 MB, 5 MB, and 10 MB.
