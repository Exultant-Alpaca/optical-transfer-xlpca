# Data

This project has no account, no cookie, no analytics, no advertisements, no telemetry, no error report, no
upload address, and no history of transfers. The file selector, the file worker, the camera decoder, and
the assembly of the file operate in the browser.

The server sends the first page and the static files. The transfer itself does not need a network between
the two devices. A server, a browser extension, or a changed build can make this different. Thus examine
the installation before you trust it.

To examine a local build, open the developer tools of the browser before you select a file. Look at the
network panel. Make sure that no request contains the name of the file, the data of the file, the camera
frames, or the transfer bytes.

The header rules permit connections to the same address, because the QR software gets its local
WebAssembly files with `fetch`. The rules also permit WebAssembly, but they do not permit other JavaScript
evaluation. Keep these rules on your own server.

The receiver does not show or save a file automatically. The user must select Save or Share.

Quick QR mode sends the file without encryption. Passphrase mode makes a key and encrypts the file in each
browser before the data goes into the frames. The software does not send the phrase. But a person who can
see the sending screen can read the phrase.
