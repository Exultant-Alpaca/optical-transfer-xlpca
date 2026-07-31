import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const distDirectory = join(projectRoot, "dist");
const serverDirectory = join(distDirectory, "server");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "server") {
        files.push(...(await collectFiles(filePath)));
      }
      continue;
    }

    const pathname = `/${relative(distDirectory, filePath).split("\\").join("/")}`;
    const content = await readFile(filePath);
    files.push({
      body: content.toString("base64"),
      contentType: contentTypes[extname(filePath)] ?? "application/octet-stream",
      pathname,
    });
  }

  return files;
}

// Hosts that understand `_headers` (Cloudflare Pages, Netlify) apply the policy
// for us. The generated worker serves the same build without that convention, so
// parse the file and emit the identical headers rather than letting the two
// deployment paths disagree about CSP.
async function readGlobalHeaders() {
  const raw = await readFile(join(distDirectory, "_headers"), "utf8").catch(() => "");
  const headers = {};
  let inGlobalBlock = false;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      inGlobalBlock = line.trim() === "/*";
      continue;
    }
    if (!inGlobalBlock) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return headers;
}

const globalHeaders = await readGlobalHeaders();
const files = await collectFiles(distDirectory);
const assetMap = Object.fromEntries(
  files.map(({ body, contentType, pathname }) => [pathname, { body, contentType }]),
);

await mkdir(serverDirectory, { recursive: true });
await writeFile(
  join(serverDirectory, "index.js"),
  `const assets = ${JSON.stringify(assetMap)};
const globalHeaders = ${JSON.stringify(globalHeaders)};

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function resolveAsset(pathname) {
  const exactAsset = assets[pathname];
  if (exactAsset) return exactAsset;

  const lastSegment = pathname.split("/").pop() ?? "";
  if (pathname === "/" || !lastSegment.includes(".")) {
    return assets["/index.html"];
  }

  return null;
}

const worker = {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    // decodeURIComponent throws on a malformed escape such as "/%", which would
    // otherwise leave the request with no response at all.
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad Request", { status: 400 });
    }
    const asset = resolveAsset(pathname);
    if (!asset) {
      return new Response("Not Found", { status: 404 });
    }

    const headers = new Headers(globalHeaders);
    headers.set("Content-Type", asset.contentType);
    headers.set("X-Content-Type-Options", "nosniff");
    if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/wasm/")) {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }

    return new Response(request.method === "HEAD" ? null : decodeBase64(asset.body), { headers });
  },
};

export default worker;
`,
);
