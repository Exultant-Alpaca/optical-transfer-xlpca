import { copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The compiled module is committed, so an ordinary build needs no Rust
// toolchain. Set QRSTATIC_REBUILD=1 to rebuild it from native/qrstatic-wasm,
// which needs cargo and the wasm32-unknown-unknown target.
const root = fileURLToPath(new URL("..", import.meta.url));
const nativeRoot = resolve(root, "native/qrstatic-wasm");
const source = resolve(nativeRoot, "target/wasm32-unknown-unknown/release/optical_transfer_demo_qrstatic_wasm.wasm");
const destination = resolve(root, "public/wasm/qrstatic_temporal.wasm");

function capture(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/**
 * cargo runs whichever `rustc` is first on PATH. When a second Rust install
 * (Homebrew's, for example) shadows the rustup one, that rustc has no
 * wasm32 standard library and the build fails with a confusing missing-std
 * error, so point cargo at the toolchain rustup actually manages.
 */
function toolchain() {
  if (process.env.CARGO) return { command: process.env.CARGO, args: [], env: {} };
  const rustc = capture("rustup", ["which", "rustc"]);
  if (rustc) return { command: "rustup", args: ["run", "stable", "cargo"], env: { RUSTC: rustc } };
  return { command: "cargo", args: [], env: {} };
}

if (process.env.QRSTATIC_REBUILD === "1" || !existsSync(destination)) {
  const { command, args, env } = toolchain();
  execFileSync(command, [...args, "build", "--release", "--target", "wasm32-unknown-unknown"], {
    cwd: nativeRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  copyFileSync(source, destination);
}

if (!existsSync(destination)) throw new Error("Missing public/wasm/qrstatic_temporal.wasm");
