// Builds the Office add-in into dist/addin.
//   BASE_URL  where taskpane.html will be served (default: GitHub Pages).
//             Example for a local server: BASE_URL=https://localhost:3000/ npm run build
import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const out = new URL("dist/addin/", root);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));

let baseUrl = process.env.BASE_URL ?? "https://apoyraz58-max.github.io/derkenar/";
if (!baseUrl.endsWith("/")) baseUrl += "/";
if (!baseUrl.startsWith("https://") && !process.env.ALLOW_HTTP) throw new Error("BASE_URL must use https:// (Office requires it).");

// Manifest versions are four numbers: 0.1.<CI run>.0, so Word replaces its cached ribbon.
const numbers = pkg.version.split(/[.-]/).filter((p) => /^\d+$/.test(p)).slice(0, 2);
const manifestVersion = [...numbers, process.env.GITHUB_RUN_NUMBER ?? "0", "0"].join(".");
const version = process.env.GITHUB_RUN_NUMBER ? `${pkg.version.replace(/-dev$/, "")}.${process.env.GITHUB_RUN_NUMBER}` : pkg.version;

await rm(out, { recursive: true, force: true });
await mkdir(new URL("assets/", out), { recursive: true });

// ES modules with code splitting: the BibTeX/RIS parser loads only when a file is imported.
for (const entry of ["taskpane", "commands"]) {
  await build({
    entryPoints: [new URL(`src/addin/${entry}.ts`, root).pathname],
    outdir: out.pathname,
    entryNames: "[name]",
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    target: ["es2018"],
    minify: true,
    sourcemap: true,
    legalComments: "external",
    define: { __VERSION__: JSON.stringify(version) },
    logLevel: "warning",
  });
}

await cp(new URL("src/addin/taskpane.css", root), new URL("taskpane.css", out));
for (const file of ["taskpane.html", "commands.html"]) {
  const html = (await readFile(new URL(`src/addin/${file}`, root), "utf8")).replace(/(src|href)="(taskpane|commands)\.(js|css)"/g, `$1="$2.$3?v=${version}"`);
  await writeFile(new URL(file, out), html);
}
await writeFile(new URL("version.json", out), JSON.stringify({ version }));
await cp(new URL("assets/icons/", root), new URL("assets/icons/", out), { recursive: true });
for (const f of await readdir(new URL("assets/", root))) if (/^icon-\d+\.png$/.test(f)) await cp(new URL(`assets/${f}`, root), new URL(`assets/${f}`, out));
await cp(new URL("assets/logo/", root), new URL("assets/logo/", out), { recursive: true });

// Fotoğraftan / PDF'ten ekle: text recognition and the PDF reader, served with the add-in and loaded on first use.
const vendor = new URL("vendor/", out);
const nm = (p) => new URL(`node_modules/${p}`, root);
await mkdir(new URL("tesseract/", vendor), { recursive: true });
await mkdir(new URL("tessdata/", vendor), { recursive: true });
await mkdir(new URL("pdfjs/", vendor), { recursive: true });
for (const f of ["tesseract.min.js", "worker.min.js"]) await cp(nm(`tesseract.js/dist/${f}`), new URL(`tesseract/${f}`, vendor));
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"]) await cp(nm(`tesseract.js-core/${f}`), new URL(`tesseract/${f}`, vendor));
for (const lang of ["tur", "eng"]) await cp(nm(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), new URL(`tessdata/${lang}.traineddata.gz`, vendor));
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) await cp(nm(`pdfjs-dist/legacy/build/${f}`), new URL(`pdfjs/${f}`, vendor));

// CSL styles and locales (CC BY-SA 3.0), loaded by the pane on demand.
await cp(new URL("data/styles/", root), new URL("styles/", out), { recursive: true });

// The book catalog (Şamile + OpenITI, reviewed entries), read by the pane on first need.
await cp(new URL("data/catalog/", root), new URL("catalog/", out), { recursive: true });

const template = await readFile(new URL("manifest/manifest.template.xml", root), "utf8");
await writeFile(new URL("manifest.xml", out), template.replaceAll("{{BASE_URL}}", baseUrl).replaceAll("{{VERSION}}", manifestVersion));
console.log(`Built Derkenar ${version} (manifest ${manifestVersion}) for ${baseUrl}`);
