import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "dist/index.js");

await rm(resolve(root, "dist"), { recursive: true, force: true });

await build({
  absWorkingDir: root,
  entryPoints: ["src/index.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  treeShaking: true,
  drop: ["debugger"],
  charset: "utf8",
  logLevel: "info",
});
