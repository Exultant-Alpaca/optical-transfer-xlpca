# Security limits

This document gives the limits of the demonstration. It is not a security examination.

## What the software examines

- The identification, the version, the type, the lengths, the block sizes, the transfer number, and the
  CRC32 value of each frame.
- The fountain blocks, before it assembles the file.
- The protocol version, the transfer number, the lengths, the compression value, and the SHA-256 value of
  the file.
- In Passphrase mode: the PBKDF2-HMAC-SHA-256 key, the AES-GCM authentication, a new nonce for each group,
  and the data of each group.
- The user must select Save or Share before the file goes to the device.
- The name and the media type of the file. The other device sends these values, so the receiver removes
  path separators, control characters, and invisible characters that change how a name reads. It also
  refuses a media type that is not a plain type token.

## What the software does not give

- Encryption in Quick QR mode. Passphrase mode encrypts the file, but only if the receiver has the correct
  phrase.
- Identification of the sender or the receiver.
- Protection from a person who looks at the sending screen or makes a video of it.
- Protection from a browser, a device, an extension, a server, or a build that a different person changed.
- Availability, a request for a second transmission, secure deletion, or protection from an attack on the
  service.

Use this project for demonstrations and test files. A secure product needs an independent examination, a
design for the keys, tests of the parser with unusual data, tests on real devices, and a controlled
release process. A person who sees the phrase can decrypt the file, and the protocol does not identify the
sender.
