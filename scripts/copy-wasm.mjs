import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = resolve(root, "node_modules/zxing-wasm/dist");
const destination = resolve(root, "public/wasm");
mkdirSync(destination, { recursive: true });

for (const name of ["zxing_reader.wasm", "zxing_writer.wasm"]) {
  const from = resolve(source, name.includes("reader") ? "reader" : "writer", name);
  if (!existsSync(from)) throw new Error(`Missing ${from}. Run npm install first.`);
  copyFileSync(from, resolve(destination, name));
}
