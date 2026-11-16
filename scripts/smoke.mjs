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
      getRange(loc) { return {
        select() { doc.selected = null; const i = doc.flow.findIndex((x) => x.cc === cc || (x.fn && x.fn.controls.includes(cc))); doc.cursor = i + 1; },
        compareLocationWith() { return { value: "Before" }; },
        expandTo() { return { text: doc.noteGap ?? "", load() { return this; } }; },
      }; },
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
  const noteAtCursor = () => (doc.noteCursor == null ? null : doc.flow.filter((x) => x.fn)[doc.noteCursor].fn);
  const selection = {
    get parentBody() {
      const fn = noteAtCursor();
      return {
        type: doc.bodyType ?? (fn ? "Footnote" : "MainDoc"),
        load() { return this; },
        contentControls: collection(fn ? fn.controls : []),
        getRange() { return { expandTo() { return { text: fn ? fn.controls.map((c) => c.text).join("") + fn.text + (doc.noteGap ?? "") : "", load() { return this; } }; } }; },
      };
    },
    getRange() {
      return {
        insertText(t) {
          const fn = noteAtCursor();
          if (fn) return { insertContentControl() { const cc = makeCC("inline"); cc.runs = [{ text: t, font: {} }]; fn.text += doc.noteGap ?? ""; fn.controls.push(cc); return cc; } };
          return { insertContentControl() { const cc = makeCC("inline"); cc.runs = [{ text: t, font: {} }]; insertAtCursor({ cc }); return cc; } };
        },
        insertFootnote() {
          if (noteAtCursor()) throw Object.assign(new Error("Word: NotAllowed"), { code: "NotAllowed" });
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
  window.__notes = () => doc.flow.filter((x) => x.fn).map((x) => x.fn.controls.map((c) => c.text).join(" | ") + x.fn.text);
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
const zoteroPosts = [];
await page.route("https://api.zotero.org/**", async (r) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Expose-Headers": "Total-Results, Last-Modified-Version" };
  if (r.request().method() === "OPTIONS") return r.fulfill({ status: 204, headers: cors });
  if (r.request().method() === "POST") {
    const body = JSON.parse(r.request().postData());
    zoteroPosts.push(body);
    const successful = Object.fromEntries(body.map((b, i) => [String(i), { key: b.key, version: 21 }]));
    return r.fulfill({ contentType: "application/json", headers: { ...cors, "Last-Modified-Version": "21" }, body: JSON.stringify({ successful, unchanged: {}, failed: {} }) });
  }
  const url = r.request().url();
  const body = url.includes("/collections")
    ? []
    : [{ key: "ZOTK2345", version: 20, data: { key: "ZOTK2345", itemType: "book", title: "Kitâbü't-Ta'arruf", creators: [{ creatorType: "author", lastName: "Kelâbâzî", firstName: "Ebû Bekir" }], publisher: "Matbaatü's-Saâde", place: "Kahire", date: "1933", tags: [{ tag: "tasavvuf" }], collections: [] } }];
  return r.fulfill({ contentType: "application/json", headers: { ...cors, "Total-Results": String(body.length), "Last-Modified-Version": "20" }, body: JSON.stringify(body) });
});
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
  if (!(await page.textContent("#ed-notes .rich")).includes("Önemli nüsha")) fail("note missing");
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
  // Quick format: "gazzali 2/10" fills cilt and sayfa.
  await page.fill("#q", "gazzali 2/10");
  await page.press("#q", "Enter");
  if ((await page.inputValue("#basket .vol")) !== "2" || (await page.inputValue('#basket [data-f="locator"]')) !== "10") fail("quick format");
  await page.press("#q", "Control+Enter");
  await waitNotes(() => window.__notes()[1] === "Gazzâlî, el-Müstasfâ min ʿilmi’l-uṣûl, 2/10.", "short form");
  await cite("yilmaz", undefined, "50");
  await cite("kemalpasazade", undefined, "12b");
  await waitNotes(() => window.__notes().length === 4, "four notes");
  n = await notes();
  if (!n[3].includes("Süleymaniye Ktp.") || !n[3].endsWith(", 12b.") || n[3].includes("vr.")) fail(`manuscript: ${n[3]}`);
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

  // 5b. Cursor in a footnote right after a citation: the new work joins it with "; " (no new note).
  const before = (await notes()).length;
  await page.evaluate(() => { window.__doc.noteCursor = 0; window.__doc.noteGap = " "; });
  await cite("kemalpasazade", undefined, "3a");
  await waitNotes(() => window.__notes()[0].includes("; Kemalpaşazâde"), "join with ;");
  if ((await notes()).length !== before) fail("a new footnote was opened inside a footnote");
  // After own text in the note ("Ayrıca bk. "): a second citation in the same note.
  await page.evaluate(() => { window.__doc.noteGap = " Ayrıca bk. "; });
  await cite("mustasfa", undefined, "9");
  await waitNotes(() => window.__notes()[0].split(" | ").length === 2, "second citation in the same note");
  if ((await notes()).length !== before) fail("a new footnote was opened (2)");
  // Word does not say the cursor is in a note: the refused footnote falls back to writing in place.
  await page.evaluate(() => { window.__doc.bodyType = "Unknown"; window.__doc.noteGap = " Krş. "; });
  await cite("yilmaz", undefined, "60");
  await waitNotes(() => window.__notes()[0].split(" | ").length === 3, "fallback after NotAllowed");
  if ((await notes()).length !== before) fail("a new footnote was opened (3)");
  await page.evaluate(() => { window.__doc.noteCursor = null; window.__doc.noteGap = undefined; window.__doc.bodyType = undefined; });

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
  if ((await page.locator("#doc-citations li").count()) !== 6) fail("document list should show 6 citations");
  if (shots) await page.screenshot({ path: `${shots}/belge.png`, fullPage: true });

  // 7b. Zotero features in the library.
  await page.click("#tab-kutuphane");
  await page.selectOption("#lib-view", "all");
  await page.click("#adv-box summary");
  await page.selectOption("#adv-conds .cond select >> nth=0", "title");
  await page.fill("#adv-conds .cond input", "kelam");
  await page.click("#adv-run");
  await page.waitForFunction(() => document.querySelectorAll("#lib-list li.item-row").length === 1);
  await page.click("#adv-save");
  await page.fill("#coll-name", "Kelâm kaynakları");
  await page.press("#coll-name", "Enter");
  await page.waitForSelector("#message:has-text('kayıtlı aramalara eklendi')");
  if (!(await page.locator("#lib-view option").allTextContents()).some((o) => o.includes("Kelâm kaynakları"))) fail("saved search missing");
  await page.selectOption("#lib-view", "all");
  // Tags: rename and color.
  await page.click("#tag-box summary");
  await page.check("#tag-manage");
  await page.waitForSelector(".tag-row");
  const usulIndex = await page.evaluate(() => [...document.querySelectorAll(".tag-row input")].findIndex((i) => i.value === "usûl"));
  if (usulIndex < 0) fail("tag usûl missing in manager");
  const usul = page.locator(".tag-row").nth(usulIndex);
  await usul.locator("select").selectOption({ index: 1 });
  await page.waitForFunction(() => [...document.querySelectorAll(".tag-row select")].some((x) => x.value !== ""));
  await usul.locator("input").fill("usûl-i fıkıh");
  await usul.locator("input").press("Enter");
  await page.waitForSelector("#message:has-text('usûl-i fıkıh')");
  await page.uncheck("#tag-manage");
  if (!(await page.locator("#lib-list .dot").count())) fail("tag color dot missing");
  // Standalone rich note and a link attachment.
  await page.selectOption("#lib-new", "note");
  await page.waitForSelector("#view-kaynak:not([hidden]) .rich");
  await page.click(".rich");
  await page.keyboard.type("Tez planı: ");
  await page.click(".rich-bar .b");
  await page.keyboard.type("önemli");
  await page.waitForTimeout(700);
  await page.click("#ed-back");
  await page.waitForSelector("#lib-list li.item-row:has-text('Tez planı')");
  await page.click("#lib-list li.item-row:has-text('Müstasfâ')");
  await page.fill("#ed-link", "https://islamansiklopedisi.org.tr/gazzali");
  await page.press("#ed-link", "Enter");
  await page.waitForSelector("#ed-attachments a:has-text('islamansiklopedisi')");
  await page.click("#ed-back");
  // Zotero: receive, edit, send back.
  await page.click("#tab-aktar");
  await page.fill("#z-id", "1234567");
  await page.fill("#z-key", "x");
  await page.click("#z-sync");
  await page.waitForSelector("#message:has-text('1 kaynak ve 0 koleksiyon')");
  await page.click("#tab-kutuphane");
  await page.click("#lib-list li.item-row:has-text('Kelâbâzî')");
  await page.fill('[data-field="title"]', "Kitâbü't-Taʿarruf li-mezhebi ehli't-tasavvuf");
  await page.waitForTimeout(600);
  await page.click("#tab-aktar");
  await page.waitForSelector("#z-push-count:has-text('1 değişiklik')");
  await page.click("#z-push");
  await page.waitForSelector("#message:has-text('1 kaynak Zotero')");
  if (zoteroPosts.length !== 1 || zoteroPosts[0][0].version !== 20 || !zoteroPosts[0][0].title.includes("li-mezhebi")) fail(`push: ${JSON.stringify(zoteroPosts)}`);
  if (await page.textContent("#z-push-count")) fail("dirty mark not cleared");
  // Zotero RDF export.
  await page.selectOption("#ex-format", "rdf");
  const [rdf] = await Promise.all([page.waitForEvent("download"), page.click("#ex-download")]);
  const rdfText = await readFile(await rdf.path(), "utf8");
  if (!rdfText.includes("<z:Collection") || !rdfText.includes("Tez planı")) fail("RDF export");

  // 8. Export (download) and the stored document state.
  await page.click("#tab-aktar");
  await page.selectOption("#ex-format", "csl");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#ex-download")]);
  const exported = JSON.parse(await readFile(await dl.path(), "utf8"));
  if (exported.length < 4 || !exported.some((e) => e.note?.includes("editorial-director: Nâşir || Ali"))) fail("CSL export");
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
