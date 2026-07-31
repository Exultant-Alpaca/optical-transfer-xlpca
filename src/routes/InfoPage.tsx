import type { ReactNode } from "react";

// The text on this site follows ASD-STE100 Simplified Technical English: one
// instruction to a sentence, the active voice, approved words in their approved
// meaning, and no more than 20 words in a procedural sentence.
export type InfoKind = "guide" | "limitations" | "source";

const content: Record<InfoKind, { title: string; body: ReactNode }> = {
  guide: {
    title: "Guide",
    body: <>
      <h2>How to send a file</h2>
      <ol>
        <li>Open the Send page on the device that has the file.</li>
        <li>Read the QR code with the second device. The QR code opens the Receive page.</li>
        <li>Select a mode and a file on the first device.</li>
        <li>Start the transfer.</li>
        <li>Point the camera of the second device at the pattern. Hold the two devices still.</li>
        <li>Wait until the second device shows the file. It examines the file before it saves it.</li>
      </ol>

      <h2>Quick QR mode</h2>
      <p>
        The sender divides the file into groups. It sends each group as a fountain code. Each frame is a
        QR code with a CRC32 check and a 128-bit transfer number.
      </p>
      <p>
        The stream does not stop. Thus the receiver can start at any time. It can also lose frames, read
        frames two times, or read frames in a different sequence, and it can still assemble the file.
      </p>

      <h2>Speed</h2>
      <p>
        There are three speeds. Compatibility mode is for old cameras. Balanced mode is the default speed.
        High density mode puts 2,896 bytes in each frame.
      </p>
      <p>
        Only the sender selects the speed. The receiver reads the speed from the frames.
      </p>
      <p>
        The sending screen shows the speed that it gets. The camera is the limit, not the sender. A camera
        that reads 30 frames each second cannot read more than 30 frames each second. If the receiver stops,
        select a lower speed.
      </p>

      <h2>Passphrase mode</h2>
      <p>
        Passphrase mode sends the same stream, but the sender encrypts it. The two browsers make an
        AES-GCM-256 key from a phrase of 8 parts. The sender shows the phrase. The user types the phrase on
        the receiver. The phrase does not go into the frames.
      </p>
      <p>
        The file data stays in the encrypted part. Thus a receiver without the phrase cannot read the name
        of the file.
      </p>

      <h2>How to save the stream as a GIF</h2>
      <p>
        The sending screen can write its frames to a GIF file. Use the GIF to examine or to send the
        stream. The GIF is not more quick than the sender. Most programs that show a GIF make it more slow.
      </p>
      <p>
        A GIF must hold a full stream. Thus this function is available only for a stream of 300 frames or
        less.
      </p>

      <h2>How to get a good read</h2>
      <ul>
        <li>Increase the brightness of the sending screen.</li>
        <li>Hold the two devices still.</li>
        <li>Keep all of the pattern in the view of the camera.</li>
        <li>Prevent reflections on the two screens.</li>
        <li>Keep the two pages open. The transfer stops if you close a page.</li>
      </ul>
    </>,
  },
  limitations: {
    title: "Limitations",
    body: <>
      <h2>This is a demonstration</h2>
      <p>
        Send one file at a time. The maximum size is 10 MB. The link is slow. A large file takes minutes.
        Keep a second copy of each file that you send.
      </p>

      <h2>There is no security</h2>
      <p>
        Quick QR mode does not encrypt the file. Passphrase mode encrypts the file, but it does not
        identify the two devices. A person who sees the sending screen can read the phrase. No specialist
        examined this software.
      </p>

      <h2>The equipment is a limit</h2>
      <p>
        The receiver needs permission to use the camera. It also needs a secure connection. These
        conditions change the speed: the brightness of the screen, the focus of the camera, the distance,
        the angle, the temperature of the device, and the browser. Do a test with your equipment.
      </p>

      <h2>QRStatic is not a transfer mode</h2>
      <p>
        The QRStatic transport decodes correctly in software. It does not decode through a camera. It needs
        the same pixel positions and the same frame sequence that the encoder made. Thus it is only a
        demonstration page.
      </p>
    </>,
  },
  source: {
    title: "Source",
    body: <>
      <h2>How to build the software</h2>
      <p>
        Install Node.js. Copy the repository. Then run <code>npm ci</code> and <code>npm run dev</code>.
        Run <code>npm run typecheck</code>, <code>npm test</code>, and <code>npm run build</code> before
        you release a build. The build makes the static files in the <code>dist/</code> directory.
      </p>

      <h2>How to host the software</h2>
      <p>
        Put the <code>dist/</code> directory on an HTTPS server. Send the index page for unknown paths.
        Keep the header rules from <code>public/_headers</code>. These rules let the local WebAssembly
        files start. There is no interface, database, account system, or upload address to operate.
      </p>

      <h2>Licenses</h2>
      <p>
        The MIT license applies to the code in this repository. It does not apply to the other software
        that this project uses. See <code>THIRD_PARTY_NOTICES.md</code> for the versions, the licenses, and
        the links.
      </p>
      <ul>
        <li><a href="https://github.com/ianzepp/qrstatic" target="_blank" rel="noreferrer">QRStatic</a>, MIT. The demonstration page uses it.</li>
        <li><a href="https://github.com/Sec-ant/zxing-wasm" target="_blank" rel="noreferrer">zxing-wasm</a>, MIT. It reads and writes the QR codes.</li>
        <li><a href="https://github.com/zxing-cpp/zxing-cpp" target="_blank" rel="noreferrer">ZXing C++</a>, Apache-2.0. zxing-wasm contains it.</li>
        <li><a href="https://github.com/zint/zint" target="_blank" rel="noreferrer">Zint</a>, BSD-3-Clause. zxing-wasm contains it.</li>
      </ul>

      <h2>Credits</h2>
      <p>
        These projects gave the ideas for the design. This release does not contain their files, but the
        ideas came first.
      </p>
      <ul>
        <li><a href="https://github.com/bashalarmistalt/decimen-optical-transfer" target="_blank" rel="noreferrer">Decimen Optical Transfer</a>, MIT. Screen to camera transfer in a browser, the fountain code, and the frame times.</li>
        <li><a href="https://github.com/mohankumarelec/airgapped-qr-code-transfer" target="_blank" rel="noreferrer">Airgapped QR Code Transfer</a>, MIT. The sequence of operations and the file handling.</li>
        <li><a href="https://github.com/divan/txqr" target="_blank" rel="noreferrer">TXQR</a>, MIT. Moving QR codes with a fountain code.</li>
        <li><a href="https://github.com/sz3/libcimbar" target="_blank" rel="noreferrer">libcimbar</a>, MPL-2.0. Colour codes with more data in each frame.</li>
      </ul>
    </>,
  },
};

export function InfoPage({ kind }: { kind: InfoKind }) {
  const page = content[kind];
  return <main>
    <h1>{page.title}</h1>
    {page.body}
  </main>;
}
