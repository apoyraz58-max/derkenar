import { build } from "esbuild";
import { pathToFileURL } from "node:url";

const entry = new URL("../src/catalog/cli.ts", import.meta.url);
const output = new URL("../dist/catalog.mjs", import.meta.url);
await build({
  entryPoints: [entry.pathname],
  outfile: output.pathname,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  logLevel: "warning",
});
await import(pathToFileURL(output.pathname).href);
