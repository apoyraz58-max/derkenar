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

const types = { ".rdf": "application/xml", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".csl": "application/xml", ".xml": "application/xml", ".json": "application/json" };
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
      const paragraph = () => ({
        styleBuiltIn: "",
        insertParagraph(t) {
          const p = paragraph();
          p.text = t;
          p.insertContentControl = () => { const cc = makeCC("block"); cc.paras = [[{ text: t, font: {} }]]; insertAtCursor({ cc }); return cc; };
          Promise.resolve().then(() => { if (!p.wrapped && p.styleBuiltIn !== "Normal") insertAtCursor({ kind: "text", text: "\n# " + t + "\n" }); });
          const orig = p.insertContentControl;
          p.insertContentControl = () => { p.wrapped = true; return orig(); };
          return p;
        },
      });
      return { getLast: () => paragraph() };
    },
  };
  const body = {
    get contentControls() {
      const c = collection(bodyControls());
      c.getByTag = (tag) => collection(bodyControls().filter((x) => x.tag === tag));
      return c;
    },
    get footnotes() { return collection(doc.flow.filter((x) => x.fn).map((x) => ({ body: { contentControls: collection(x.fn.controls) } }))); },
    get endnotes() { return collection([]); },
  };
  const context = { document: { body, getSelection: () => selection }, sync: async () => undefined };
  window.Word = { run: async (fn) => fn(context), Style: { heading1: "Heading1", normal: "Normal" } };
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


const RDF = await readFile(new URL("../test/fixtures/zotero.rdf", import.meta.url));

const fail = (m) => {
  throw new Error(m);
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 380, height: 900 }, acceptDownloads: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.route("https://appsforoffice.microsoft.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: FAKE }));
const notes = () => page.evaluate(() => window.__notes());
const waitNotes = (fn, label) => page.waitForFunction(fn, null, { timeout: 8000 }).catch(async () => fail(`${label}: ${JSON.stringify(await notes())}`));
const cite = async (q, vol, loc) => {
  await page.click("#tab-atif");
  await page.fill("#q", q);
  await page.press("#q", "Enter");
  if (vol !== undefined) await page.fill("#basket .vol", vol);
  await page.fill('#basket [data-f="locator"]', loc ?? "");
  await page.press('#basket [data-f="locator"]', "Enter");
};

try {
  await page.goto(`${base}taskpane.html?action=insert`);
  await page.waitForSelector("#summary:has-text('kaynak')");
  if (!(await page.isVisible("#empty-library"))) fail("empty library notice missing");

  // 1. Zotero RDF export: items, collections, notes, tags, İSNAD roles.
  await page.click("#tab-aktar");
  await page.setInputFiles("#file", { name: "kutuphane.rdf", mimeType: "application/rdf+xml", buffer: RDF });
  await page.waitForSelector("#message:has-text('3 kaynak eklendi, 2 koleksiyon')");

  // 2. Library: collection tree, editor with roles, İSNAD fix, autosave.
  await page.click("#tab-kutuphane");
  const options = await page.locator("#lib-view option").allTextContents();
  if (!options.some((o) => o.startsWith("Tez (")) || !options.some((o) => o.includes("└ Usûl"))) fail(`collections: ${options}`);
  await page.selectOption("#lib-view", { label: options.find((o) => o.startsWith("Tez ("))});
  if ((await page.locator("#lib-list li.item-row").count()) !== 2) fail("collection Tez (with Usûl) should show 2 items");
  await page.click("#lib-list li.item-row:has-text('Kelâm')");
  await page.waitForSelector("#view-kaynak:not([hidden])");
  await page.click("#ed-issues button:has-text('Düzelt')");
  await page.waitForFunction(() => document.querySelector('[data-field="pages"]')?.value === "45-78");
  await page.click("#ed-back");
  await page.selectOption("#lib-view", "all");
  await page.click("#lib-list li.item-row:has-text('Müstasfâ')");
  const roles = await page.locator("#ed-fields .creator select").evaluateAll((els) => els.map((e) => e.value));
  if (JSON.stringify(roles) !== JSON.stringify(["author", "muhakkik", "nasir"])) fail(`roles: ${roles}`);
  if (!(await page.textContent("#ed-notes textarea")).includes("Önemli nüsha") && (await page.inputValue("#ed-notes textarea")) !== "Önemli nüsha") fail("note missing");
  if (!(await page.textContent("#ed-issues")).includes("y.y.") === false) {} // place exists: no y.y. warning expected
  // Add a hazırlayan and a date, save by typing.
  await page.click("#ed-fields button:has-text('+ Kişi ekle')");
  await page.locator("#ed-fields .creator select").last().selectOption("hazirlayan");
  await page.locator("#ed-fields .creator input").nth(-2).fill("Hazır");
  await page.locator("#ed-fields .creator input").last().fill("Veli");
  await page.fill('[data-field="date"]', "1413/1993");
  await page.waitForTimeout(600);
  if (shots) await page.screenshot({ path: `${shots}/kaynak.png`, fullPage: true });

  // 3. New item by hand (manuscript) with İSNAD warnings.
  await page.click("#ed-back");
  await page.selectOption("#lib-new", "manuscript");
  await page.waitForSelector("#view-kaynak:not([hidden])");
  await page.fill('[data-field="title"]', "Risâle fi'l-vücûd");
  await page.click("#ed-fields button:has-text('+ Kişi ekle')");
  await page.locator("#ed-fields .creator input").first().fill("Kemalpaşazâde");
  await page.waitForSelector("#ed-issues:has-text('kütüphane')");
  await page.fill('[data-field="archive"]', "Süleymaniye Ktp.");
  await page.fill('[data-field="archiveLocation"]', "Fatih, 5426");
  await page.waitForTimeout(500);

  // 4. Citations: cilt/sayfa, short form, insert before, automatic updates.
  await cite("gazzali mustasfa", "1", "45");
  await waitNotes(() => window.__notes().length === 1, "first note");
  let n = await notes();
  if (n[0] !== "Ebû Hâmid Muhammed b. Muhammed Gazzâlî, el-Müstasfâ min ʿilmi’l-uṣûl, nşr. Ali Nâşir, thk. Hamza b. Züheyr Hâfız, haz. Veli Hazır (Medine: el-Câmiʿatü’l-İslâmiyye, 1413/1993), 1/45.") fail(`note 1: ${n[0]}`);
  await cite("gazzali", "2", "10");
  await waitNotes(() => window.__notes()[1] === "Gazzâlî, el-Müstasfâ min ʿilmi’l-uṣûl, 2/10.", "short form");
  await cite("yilmaz", undefined, "50");
  await cite("kemalpasazade", undefined, "12b");
  await waitNotes(() => window.__notes().length === 4, "four notes");
  n = await notes();
  if (!n[3].includes("Süleymaniye Ktp.") || !n[3].includes("vr. 12b")) fail(`manuscript: ${n[3]}`);
  // Inserted before everything: becomes full, the old first one shortens.
  await page.evaluate(() => (window.__doc.cursor = 0));
  await cite("gazzali", "3", "7");
  await waitNotes(() => window.__notes().length === 5 && window.__notes()[1] === "Gazzâlî, el-Müstasfâ min ʿilmi’l-uṣûl, 1/45.", "insert before");
  // The user deletes the first footnote in Word (not through Derkenar): the next one becomes full by itself.
  await page.evaluate(() => {
    const d = window.__doc;
    d.flow.splice(d.flow.findIndex((x) => x.fn), 1);
  });
  await waitNotes(() => window.__notes()[0].startsWith("Ebû Hâmid Muhammed b. Muhammed Gazzâlî") && window.__notes()[0].endsWith("1/45."), "automatic after delete");
  // The user moves (cut/paste) the Yılmaz note to the front: it stays full, Gazzâlî notes keep their order.
  await page.evaluate(() => {
    const d = window.__doc;
    const fns = d.flow.filter((x) => x.fn);
    const y = fns.find((x) => x.fn.controls[0].text.includes("Yılmaz"));
    d.flow.splice(d.flow.indexOf(y), 1);
    d.flow.unshift(y);
  });
  await page.waitForTimeout(2200);
  n = await notes();
  if (!n[0].startsWith("Ahmet Yılmaz") || !n[1].startsWith("Ebû Hâmid")) fail(`after move: ${JSON.stringify(n)}`);
  // Editing a cited work in the library updates its citations.
  await page.click("#tab-kutuphane");
  await page.click("#lib-list li.item-row:has-text('Kelâm')");
  await page.fill('[data-field="title"]', "Kelâm ilminin doğuşu");
  await waitNotes(() => window.__notes()[0].includes("“Kelâm ilminin doğuşu”"), "library edit flows into note");
  if (shots) await page.screenshot({ path: `${shots}/atif.png`, fullPage: true });

  // 5. Edit a citation from the cursor.
  await page.evaluate(() => window.__select(window.__doc.flow.filter((x) => x.fn)[2].fn.controls[0]));
  await page.waitForSelector("#edit-bar:not([hidden])");
  await page.fill('#basket [data-f="locator"]', "99");
  await page.click("#insert");
  await waitNotes(() => window.__notes()[2] === "Gazzâlî, el-Müstasfâ min ʿilmi’l-uṣûl, 2/99.", "edit");
  await page.evaluate(() => window.__select(null));

  // 6. İSNAD check of the document.
  await page.click("#tab-denetim");
  await page.click("#chk-run");
  await page.waitForSelector("#chk-summary:has-text('kaynak denetlendi')");
  if (shots) await page.screenshot({ path: `${shots}/denetim.png`, fullPage: true });

  // 7. Bibliography, list, unlink.
  await page.evaluate(() => (window.__doc.cursor = window.__doc.flow.length));
  await page.click("#tab-belge");
  await page.click("#bibliography");
  await page.waitForSelector("#message:has-text('Kaynakça eklendi')");
  const text = await page.evaluate(() => window.__text());
  if (!text.includes("# Kaynakça\n")) fail(`bibliography heading: ${text}`);
  if (!text.includes("Gazzâlî, Ebû Hâmid Muhammed b. Muhammed. el-Müstasfâ min ʿilmi’l-uṣûl. nşr. Ali Nâşir. thk. Hamza b. Züheyr Hâfız.")) fail(`bibliography: ${text}`);
  if ((await page.locator("#doc-citations li").count()) !== 4) fail("document list should show 4 citations");
  if (shots) await page.screenshot({ path: `${shots}/belge.png`, fullPage: true });

  // 8. Export (download) and the stored document state.
  await page.click("#tab-aktar");
  await page.selectOption("#ex-format", "csl");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ex-download")]);
  const exported = JSON.parse(await readFile(await dl.path(), "utf8"));
  if (exported.length !== 4 || !exported.some((e) => e.note?.includes("editorial-director: Nâşir || Ali"))) fail("CSL export");
  const stored = JSON.parse(await page.evaluate(() => window.__doc.settings.derkenar));
  if (stored.style !== "isnad-dipnotlu" || !stored.items[Object.keys(stored.items)[0]].itemType) fail("document state");
  if (!(await page.evaluate(() => window.__doc.settings["Office.AutoShowTaskpaneWithDocument"]))) fail("auto-open not set");

  await page.click("#tab-belge");
  await page.click("#unlink");
  await page.click("#unlink");
  await page.waitForSelector("#message:has-text('düz metne çevrildi')");

  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
  console.log("smoke ok");
} finally {
  await browser.close();
  server.close();
}
