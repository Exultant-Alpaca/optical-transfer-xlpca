# Protocol version 1

## Quick QR

The sender makes a random 128-bit transfer number. It prepares the file on the device. It then writes the
file data with its length in front, and the transmitted bytes after it. It divides this data into groups.
It encodes each group as a fountain code and puts each block into a binary frame with a CRC32 value.

The receiver can start at any time. It examines the identification, the version, the limits, the transfer
number, the block sizes, and the CRC32 value before it gives a block to the fountain decoder. It accepts
the groups in any sequence. It ignores blocks that it has. It assembles the file only when all groups are
complete. The SHA-256 value applies to the bytes that the sender transmitted.

The file data contains `encryption: "none"` for Quick QR mode and `encryption: "aes-gcm"` for Passphrase
mode. In Passphrase mode the two devices make the same AES-GCM-256 key with PBKDF2-HMAC-SHA-256. The random
128-bit transfer number is the salt. The phrase does not go into the file data or into a frame. Each group
gets a new 96-bit nonce and an authentication value. The file data stays in the encrypted part. Thus a
receiver without the phrase cannot read the name of the file.

Passphrase mode uses a phrase that a person types. It is not a short code for two devices. It is only as
secret as the phrase. A person who reads the phrase can decrypt the transfer. The software uses the Web
Crypto interface of the browser. No specialist examined this code.

## Speed

Each speed has its own frame rate: 6, 8, and 20 frames each second. Only the sender selects the speed,
because the receiver reads the block sizes from each frame.

The frame rate is a target for the sender. The sending screen shows the rate that it gets. A camera that
reads 30 frames each second cannot use more frames than that.

## QRStatic

QRStatic puts the file data and the file bytes into blocks. Each block has the `QTT1` identification, a
session number, a block number, a block count, a payload length, and a CRC32 value. The software shows each
block as a window of 64 noise frames of 320 x 240.

This operates only on the demonstration page, from the encoder to the decoder in one browser. It is not an
optical transport. The codec moves each cell to a different position in each frame. Thus the decoder needs
the same pixel positions and the same frame sequence that the encoder made. See `qrstatic-notes.md` for the
measurements.

## Photographs

The software can make a large photograph smaller on the device. The user selects the quality. The software
keeps the smaller photograph only if it is much smaller. The file data gives the name, the type, the
length, the SHA-256 value, and the original size of the photograph. The software does not change moving
images, small images, images that it cannot read, and files that are not images.

## Binary frame

```text
identification[4] version[1] type[1] transferNumber[16]
groupNumber[u16] groupCount[u16] sequence[u32]
blockCount[u32] blockSize[u16]
encodedLength[u32] plainLength[u32] crc32[u32]
fountainBlock[blockSize]
```

The CRC32 value applies to the frame with a CRC32 field of zero. It finds accidental damage. It is not a
security control. In Passphrase mode, AES-GCM also authenticates each encrypted group. The software
examines each value before it allocates memory.
