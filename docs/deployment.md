# How to release

## Static server

Build the application. Then put `dist/` on an HTTPS server. Send the index page for unknown paths.

```sh
npm ci
npm run build
```

The build contains the local QR and QRStatic WebAssembly files. Keep the rules of `public/_headers` in the
configuration of your server. The application needs connections to the same address for its own files. It
also needs permission to use WebAssembly.

## A different directory

```sh
VITE_BASE_PATH=/transfer/ npm run build
```

Put the files in the `/transfer/` directory. Keep the service worker in the same directory. Thus its
control does not go outside of the application.

## Vercel

The repository includes `vercel.json` for a Vite deployment. It sets `npm run build`, `dist` as the output
directory, client-side route rewrites, and the security headers from `public/_headers`. Set the Vercel Root
Directory to the repository root. Deploy with `npx vercel` for a preview or `npx vercel --prod` for the
production deployment.

## Examinations before a release

1. Make a record of the source revision, the lock file, and the WebAssembly files.
2. Run `npm run typecheck`, `npm test`, and `npm run build`.
3. Test these conditions: no permission for the camera, permission that the user removes, a change of page,
   a cancelled transfer, a page in the background, and a sender that starts again.
4. Test Quick QR mode with each telephone, tablet, and computer that you support.
5. Test Passphrase mode with the correct phrase and with an incorrect phrase. Make sure that the incorrect
   phrase does not complete the transfer.
6. Look at the frame rate on the sending screen, especially in High density mode.
7. Make a GIF file from the sending screen. Make sure that it opens and that it moves.
8. Open `/qrstatic`. Make sure that the demonstration encodes and decodes the message.
9. Read `LICENSE` and `THIRD_PARTY_NOTICES.md` before you give the build to other persons.
