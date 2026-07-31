# QRStatic: why it is a demonstration and not a transfer mode

[QRStatic](https://github.com/ianzepp/qrstatic) hides a QR code in noise. Each frame looks like static. The
code becomes visible only when the software compares 64 frames with the key. This project makes a
WebAssembly module from a given revision of it and operates it at `/qrstatic`.

QRStatic was a camera transfer mode until these measurements. It never completed a transfer, and it cannot.

## What the codec needs

The codec moves each cell to a different position in each frame. It then finds the signal when it compares
the frames with the correct key. Thus the decode needs these conditions:

- the same pixel positions that the encoder made, with no change of size, no cut, no rotation, and no
  movement of less than one pixel;
- the same frame sequence, with no frame lost, no frame two times, and no change of sequence;
- cell values that did not mix with the values of the cells adjacent to them.

The format has no marks for position, no start signal, and no frame numbers. Thus a receiver cannot find
these conditions by itself.

## What a camera does

`native/qrstatic-wasm/src/lib.rs` contains the measurements. Each test encodes one window with the
configuration of this project and then decodes it:

| Window | Result |
| --- | --- |
| No change | It decodes each time |
| Moved one pixel to the side | No decode |
| Started one frame late | No decode |
| Small blur | No decode |

A camera makes all three of these conditions at the same time and continuously.

## Do a lower frame rate or less data help?

No. `native/qrstatic-wasm/tests/camera_path.rs` examines the changes that a sender can make. The simulated
camera is very good in all other conditions: correct exposure, no rotation, no rolling shutter, no sensor
noise, and a receiver that knows which frame is frame zero.

| Change | Result |
| --- | --- |
| Less data in each frame, same grid | No decode. The codec moves cells, not bytes. Thus the optics find the same problem. |
| Each cell as 4 x 4 screen pixels | **It decodes.** The blur stays in one cell and does not mix cells. |
| Large cells, sampled one cell to the side | No decode. |
| Large cells, window started one frame late | No decode. |

Thus there is one change that helps, and it is not the frame rate and not the quantity of data: use fewer
and larger cells. This corrects the problem of the optics. It does not correct the position or the frame
sequence.

Run all of the tests with this command:

```sh
cd native/qrstatic-wasm
cargo test --release --target "$(rustc -vV | sed -n 's/host: //p')"
```

## What a camera mode needs

This is a design idea. It is not work in the plan:

1. **Marks for the position.** Put marks around the frame. The receiver must find the corners and
   calculate the positions of the cell centres. The accuracy must be less than one pixel.
2. **Larger cells.** Encode a smaller grid, for example 80 x 60. Show each cell as a block of screen
   pixels. Thus the blur stays in one cell.
3. **Frame numbers.** Show a counter or a pattern outside of the noise area. A camera and a screen do not
   agree about time. Thus frames are lost or repeated.
4. **Calibration of the brightness.** Show an area of known brightness, because a camera does not have a
   linear response.

Items 1 and 3 change the data format. Thus they are work for the codec and not for this project.

## What operates today

The page at `/qrstatic` operates the full sequence in one browser: it encodes a message, shows the window
of 64 frames, decodes that window in the same worker that the camera receiver used, assembles the QTT1
blocks, and examines the SHA-256 value. This shows that the transport operates. It does not show that the
transport operates through a lens.

Use Quick QR mode or Passphrase mode to send a file.
