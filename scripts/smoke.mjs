// End-to-end smoke test of the built pane in Chromium with a fake Word.
// The fake keeps the document as a flow of text, citation controls and
// footnotes, and implements only the WordApi calls src/addin/word.ts uses.
// Run after `npm run build`:  npm run smoke   (SMOKE_SCREENSHOT=dir saves screenshots)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const dist = new URL("../dist/addin/", import.meta.url);
const shots = process.env.SMOKE_SCREENSHOT;

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".csl": "application/xml", ".xml": "application/xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(`.${new URL(req.url, "http://x").pathname}`, dist);
    const body = await readFile(path);
    res.writeHead(200, { "content-type": types[extname(path.pathname)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const FAKE = String.raw`
(() => {
  const doc = (window.__doc = { flow: [], cursor: 0, settings: {}, selected: null, nextId: 1, footnotes: true });
  const font = () => ({});
  const runText = (runs) => runs.map((r) => r.text).join("");
  function makeCC(kind) {
    const cc = { id: doc.nextId++, tag: "", title: "", appearance: "", kind, runs: [], paras: [[]], deleted: false,
      load() { return cc; },
      get text() { return kind === "block" ? cc.paras.map(runText).join("\r") : runText(cc.runs); },
      insertText(t, where) {
        const run = { text: t, font: {} };
        if (kind === "block") { const p = cc.paras[cc.paras.length - 1]; if (where === "Replace") p.length = 0; p.push(run); }
        else { if (where === "Replace") cc.runs = []; cc.runs.push(run); }
        return { font: run.font };
      },
      getRange(loc) { return { select() { doc.selected = null; const i = doc.flow.findIndex((x) => x.cc === cc || (x.fn && x.fn.controls.includes(cc))); doc.cursor = i + 1; } }; },
      select() { doc.selected = cc; },
      clear() { cc.paras = [[]]; cc.runs = []; },
      get paragraphs() { return { getFirst: () => para(cc, 0) }; },
      insertParagraph(t, where) { cc.paras.push(t ? [{ text: t, font: {} }] : []); return para(cc, cc.paras.length - 1); },
      delete(keep) {
        cc.deleted = true;
        for (const x of doc.flow) {
          if (x.cc === cc) { x.kind = "text"; x.text = cc.text; delete x.cc; }
          if (x.fn) { const i = x.fn.controls.indexOf(cc); if (i >= 0) { x.fn.controls.splice(i, 1); x.fn.text += cc.text; } }
        }
      },
    };
    return cc;
  }
  function para(cc, i) {
    return { leftIndent: 0, firstLineIndent: 0, insertText(t) { const run = { text: t, font: {} }; cc.paras[i].push(run); return { font: run.font }; } };
  }
  const collection = (items) => ({ items, load() { return this; } });
  const bodyControls = () => doc.flow.filter((x) => x.cc).map((x) => x.cc);
  function insertAtCursor(entry) { doc.flow.splice(doc.cursor, 0, entry); doc.cursor++; }
  const selection = {
    getRange() {
      return {
        insertText(t) {
          return { insertContentControl() { const cc = makeCC("inline"); cc.runs = [{ text: t, font: {} }]; insertAtCursor({ cc }); return cc; } };
        },
        insertFootnote() {
          const fn = { controls: [], text: "" };
          insertAtCursor({ fn });
          return { body: { getRange() { return { insertText(t) { return { insertContentControl() { const cc = makeCC("inline"); cc.runs = [{ text: t, font: {} }]; fn.controls.push(cc); return cc; } }; } }; } } };
        },
      };
    },
    get parentContentControlOrNullObject() {
      const cc = doc.selected;
      return cc ? Object.assign(cc, { isNullObject: false }) : { isNullObject: true, load() { return this; } };
    },
    get paragraphs() {
      return { getLast: () => ({ insertParagraph(t) { return { insertContentControl() { const cc = makeCC("block"); cc.paras = [[{ text: t, font: {} }]]; insertAtCursor({ cc }); return cc; } }; } }) };
    },
  };
  const body = {
    get contentControls() {
      const c = collection(bodyControls());
      c.getByTag = (tag) => collection(bodyControls().filter((x) => x.tag === tag));
      return c;
    },
    get footnotes() { return collection(doc.flow.filter((x) => x.fn).map((x) => ({ body: { contentControls: collection(x.fn.controls) } }))); },
  };
  const context = { document: { body, getSelection: () => selection }, sync: async () => undefined };
  window.Word = { run: async (fn) => fn(context) };
  let selHandler = null;
  window.Office = {
    onReady: (cb) => Promise.resolve().then(() => cb({ host: "Word" })),
    AsyncResultStatus: { Succeeded: "succeeded" },
    EventType: { DocumentSelectionChanged: "sel" },
    context: {
      requirements: { isSetSupported: (name, v) => name === "WordApi" && (v !== "1.5" || doc.footnotes) },
      document: {
        settings: { get: (k) => doc.settings[k] ?? null, set: (k, v) => (doc.settings[k] = v), saveAsync: (cb) => cb({ status: "succeeded" }) },
        addHandlerAsync: (_t, h) => (selHandler = h),
      },
    },
  };
  window.__makeCC = makeCC;
  window.__select = (cc) => { doc.selected = cc; selHandler && selHandler(); };
  window.__text = () => doc.flow.map((x) => x.cc ? (x.cc.kind === "block" ? "\n[KAYNAKÇA]\n" + x.cc.paras.map(runText).join("\n") + "\n" : "{" + x.cc.text + "}") : x.fn ? "[^" + x.fn.controls.map((c) => c.text).join("") + x.fn.text + "]" : x.text).join("");
  window.__notes = () => doc.flow.filter((x) => x.fn).map((x) => x.fn.controls.map((c) => c.text).join("") + x.fn.text);
})();
`;

const BIB = String.raw`@book{gazzali1982, author={Gazz{\^a}l{\^\i}, Eb{\^u} H{\^a}mid}, title={{\.I}hy{\^a}{\"u} ul{\^u}mi'd-d{\^\i}n}, publisher={D{\^a}ru'l-Ma'rife}, address={Beyrut}, year={1982}}
@article{yilmaz2004, author={Y{\i}lmaz, Ahmet}, title={Kel{\^a}m ilminin tarih{\^\i} geli{\c s}imi}, journal={{\.I}sl{\^a}m Ara{\c s}t{\i}rmalar{\i} Dergisi}, volume={12}, pages={45--78}, year={2004}}`;

const ZOTERO = [
  { key: "ZK000001", version: 7, data: { itemType: "book", collections: [], tags: [{ tag: "tasavvuf" }] }, csljson: { id: "1/ZK000001", type: "book", title: "Kitâbü't-Ta'arruf", author: [{ family: "Kelâbâzî", given: "Ebû Bekir" }], issued: { "date-parts": [[1933]] }, publisher: "Matbaatü's-Saâde", "publisher-place": "Kahire" } },
  { key: "ZNOTE001", version: 7, data: { itemType: "note" } },
];

const fail = (m) => {
  throw new Error(m);
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.route("https://appsforoffice.microsoft.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE }));
await page.route("https://api.zotero.org/**", (r) =>
  r.fulfill({
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Total-Results": "2", "Last-Modified-Version": "7", "Access-Control-Expose-Headers": "Total-Results, Last-Modified-Version" },
    body: JSON.stringify(r.request().url().includes("/collections") ? [] : ZOTERO),
  }),
);

try {
  await page.goto(`${base}taskpane.html?action=insert`);
  await page.waitForSelector("#summary:has-text('kaynak')");
  if (!(await page.isVisible("#empty-library"))) fail("empty library notice missing");

  // Library: BibTeX file and Zotero.
  await page.click("#tab-kutuphane");
  await page.setInputFiles("#file", { name: "tez.bib", mimeType: "text/plain", buffer: Buffer.from(BIB) });
  await page.waitForSelector("#message:has-text('2 kaynak içe aktarıldı')");
  await page.fill("#z-id", "1234567");
  await page.fill("#z-key", "x");
  await page.click("#z-sync");
  await page.waitForSelector("#message:has-text('1 kaynak Zotero')");
  if (!(await page.textContent("#lib-count")).startsWith("3 ")) fail("library should hold 3 items");
  if (shots) await page.screenshot({ path: `${shots}/kutuphane.png`, fullPage: true });

  // Search without diacritics, add page, insert with Ctrl+Enter.
  await page.click("#tab-atif");
  await page.fill("#q", "gazzali ihya");
  await page.waitForSelector("#results li");
  if ((await page.locator("#results li").count()) !== 1) fail("search should find one work");
  await page.press("#q", "Enter");
  await page.fill('[data-f="locator"]', "12");
  await page.waitForFunction(() => document.querySelector("#preview")?.textContent?.includes("12"));
  const preview = await page.textContent("#preview");
  if (!preview.includes("Gazzâlî")) fail(`preview: ${preview}`);
  if (shots) await page.screenshot({ path: `${shots}/atif.png`, fullPage: true });
  await page.press('[data-f="locator"]', "Enter");
  await page.waitForFunction(() => window.__notes().length === 1);

  // Second citation of the same work → short form.
  await page.fill("#q", "gazzali");
  await page.press("#q", "Enter");
  await page.fill('[data-f="locator"]', "15");
  await page.press('[data-f="locator"]', "Control+Enter");
  await page.waitForFunction(() => window.__notes().length === 2);
  let notes = await page.evaluate(() => window.__notes());
  if (notes[0] !== "Ebû Hâmid Gazzâlî, İhyâü ulûmi’d-dîn (Beyrut: Dâru’l-Ma’rife, 1982), 12.") fail(`note 1: ${notes[0]}`);
  if (notes[1] !== "Gazzâlî, İhyâü ulûmi’d-dîn, 15.") fail(`note 2: ${notes[1]}`);

  // A citation inserted before the others takes the full form; the old first one becomes short.
  await page.evaluate(() => (window.__doc.cursor = 0));
  await page.fill("#q", "gazzali");
  await page.press("#q", "Enter");
  await page.fill('[data-f="locator"]', "3");
  await page.press('[data-f="locator"]', "Enter");
  await page.waitForFunction(() => window.__notes().length === 3);
  notes = await page.evaluate(() => window.__notes());
  if (!notes[0].startsWith("Ebû Hâmid Gazzâlî") || notes[1] !== "Gazzâlî, İhyâü ulûmi’d-dîn, 12.") fail(`reorder: ${JSON.stringify(notes)}`);

  // Two works in one citation, Zotero item, multiple refs.
  await page.evaluate(() => (window.__doc.cursor = window.__doc.flow.length));
  await page.fill("#q", "yilmaz");
  await page.press("#q", "Enter");
  await page.fill("#q", "kelabazi");
  await page.press("#q", "Enter");
  await page.press("#q", "Control+Enter");
  await page.waitForFunction(() => window.__notes().length === 4);
  notes = await page.evaluate(() => window.__notes());
  if (!notes[3].includes("Yılmaz") || !notes[3].includes("Kelâbâzî")) fail(`multi: ${notes[3]}`);

  // Edit: cursor in the second note → basket filled → change page → update.
  await page.evaluate(() => window.__select(window.__doc.flow.filter((x) => x.fn)[1].fn.controls[0]));
  await page.waitForSelector("#edit-bar:not([hidden])");
  await page.fill('[data-f="locator"]', "99");
  await page.click("#insert");
  await page.waitForFunction(() => window.__notes()[1] === "Gazzâlî, İhyâü ulûmi’d-dîn, 99.");

  // Bibliography and style change.
  await page.evaluate(() => {
    window.__select(null);
    window.__doc.cursor = window.__doc.flow.length;
  });
  await page.click("#tab-belge");
  await page.click("#bibliography");
  await page.waitForSelector("#message:has-text('Kaynakça eklendi')");
  let text = await page.evaluate(() => window.__text());
  if (!text.includes("Gazzâlî, Ebû Hâmid. İhyâü ulûmi’d-dîn. Beyrut: Dâru’l-Ma’rife, 1982.")) fail(`bibliography: ${text}`);
  if (!text.includes("Kelâbâzî, Ebû Bekir.")) fail("bibliography lacks the Zotero item");
  if ((await page.locator("#doc-citations li").count()) !== 4) fail("document list should show 4 citations");
  await page.selectOption("#style", "apa");
  await page.waitForSelector("#message:has-text('Stil: APA 7')");
  notes = await page.evaluate(() => window.__notes());
  if (notes[1] !== "(Gazzâlî, 1982, s. 99)") fail(`apa: ${notes[1]}`);
  text = await page.evaluate(() => window.__text());
  if (!text.includes("Gazzâlî, E. H. (1982). İhyâü ulûmi’d-dîn. Dâru’l-Ma’rife.")) fail(`apa bibliography: ${text}`);
  if (shots) await page.screenshot({ path: `${shots}/belge.png`, fullPage: true });

  // Copied citation gets its own id; a refresh keeps the data.
  await page.evaluate(() => {
    const d = window.__doc;
    const src = d.flow.filter((x) => x.fn)[0].fn.controls[0];
    const copy = window.__makeCC("inline");
    copy.tag = src.tag;
    copy.runs = src.runs.map((r) => ({ ...r }));
    d.flow.push({ fn: { controls: [copy], text: "" } });
  });
  await page.click("#refresh");
  await page.waitForSelector("#message:has-text('Belge güncellendi')");
  const tags = await page.evaluate(() => window.__doc.flow.filter((x) => x.fn).map((x) => x.fn.controls[0]?.tag));
  if (new Set(tags).size !== tags.length) fail(`copied citation kept the same tag: ${tags}`);

  // Settings survive: the stored state holds style and works.
  const stored = JSON.parse(await page.evaluate(() => window.__doc.settings.kunye));
  if (stored.style !== "apa" || Object.keys(stored.items).length !== 3) fail("document state not saved");

  // Unlink needs two clicks.
  await page.click("#unlink");
  await page.click("#unlink");
  await page.waitForSelector("#message:has-text('düz metne çevrildi')");
  const left = await page.evaluate(() => window.__doc.flow.filter((x) => x.cc && !x.cc.deleted).length + window.__doc.flow.filter((x) => x.fn && x.fn.controls.length).length);
  if (left !== 0) fail("controls left after unlink");

  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
  console.log("smoke ok");
} finally {
  await browser.close();
  server.close();
}
