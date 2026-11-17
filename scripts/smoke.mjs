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

const types = { ".svg": "image/svg+xml", ".rdf": "application/xml", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".csl": "application/xml", ".xml": "application/xml", ".json": "application/json" };
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
        insertFootnote() {
          const fn = { controls: [], text: "" };
          const i = doc.flow.findIndex((x) => x.cc === cc);
          doc.flow.splice(i + 1, 0, { fn });
          return { body: { getRange() { return { insertText(t) { return { insertContentControl() { const n = makeCC("inline"); n.runs = [{ text: t, font: {} }]; fn.controls.push(n); return n; } }; } }; } } };
        },
        expandTo() { return { text: doc.noteGap ?? "", load() { return this; } }; },
      }; },
      select() { doc.selected = cc; },
      clear() { cc.paras = [[]]; cc.runs = []; },
      get paragraphs() { return { getFirst: () => para(cc, 0) }; },
      insertParagraph(t, where) { cc.paras.push(t ? [{ text: t, font: {} }] : []); return para(cc, cc.paras.length - 1); },
      delete(keep) {
        cc.deleted = true;
        if (keep === false) {
          const i = doc.flow.findIndex((x) => x.cc === cc);
          if (i >= 0) { doc.flow.splice(i, 1); return; }
          for (const x of doc.flow) if (x.fn) { const j = x.fn.controls.indexOf(cc); if (j >= 0) { x.fn.controls.splice(j, 1); return; } }
        }
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
    insertText(t) {
      const sel = doc.fieldSel;
      if (!sel) throw new Error("no field selected");
      doc.fieldSel = null;
      return {
        insertContentControl() { const cc = makeCC("inline"); cc.runs = [{ text: t, font: {} }]; sel.replace({ cc }); return cc; },
        paragraphs: { getFirst() { return { styleBuiltIn: "", insertContentControl() { const cc = makeCC("block"); cc.paras = [[{ text: t, font: {} }]]; sel.replace({ cc, block: true }); return cc; } }; } },
      };
    },
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
  // Fields of another citation program: in the text and in footnotes.
  const fieldProxy = (code, replace) => ({ code, select() { doc.fieldSel = { replace }; }, load() { return this; } });
  const body = {
    get text() { return doc.flow.map((x) => (x.cc ? x.cc.text : x.fn ? "" : x.text ?? "")).join(""); },
    load() { return this; },
    get fields() {
      return collection(doc.flow.filter((x) => x.field).map((x) => fieldProxy(x.field.code, (n) => { const i = doc.flow.indexOf(x); doc.flow[i] = n.block ? { cc: n.cc } : { cc: n.cc }; })));
    },
    get contentControls() {
      const c = collection(bodyControls());
      c.getByTag = (tag) => collection(bodyControls().filter((x) => x.tag === tag));
      return c;
    },
    get footnotes() {
      return collection(doc.flow.filter((x) => x.fn).map((x) => {
        const ccs = collection(x.fn.controls);
        ccs.getByTag = (tag) => collection(x.fn.controls.filter((c) => c.tag === tag));
        return {
          body: { contentControls: ccs, get fields() { return collection((x.fn.fields ?? []).map((f) => fieldProxy(f.code, (n) => { x.fn.fields.splice(x.fn.fields.indexOf(f), 1); x.fn.controls.push(n.cc); }))); }, get text() { return x.fn.controls.map((c) => c.text).join("") + x.fn.text + (x.fn.fields ?? []).map((f) => f.text).join(""); }, load() { return this; } },
          delete() { doc.flow.splice(doc.flow.indexOf(x), 1); },
          reference: { insertText(t) { return { insertContentControl() { const n = makeCC("inline"); n.runs = [{ text: t, font: {} }]; doc.flow.splice(doc.flow.indexOf(x), 0, { cc: n }); return n; } }; } },
        };
      }));
    },
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
  const xmlParts = () => JSON.parse(sessionStorage.getItem("__xml") || "[]");
  const saveParts = (p) => sessionStorage.setItem("__xml", JSON.stringify(p));
  Office.context.document.customXmlParts = {
    addAsync(xml, cb) { const p = xmlParts(); const id = Math.random().toString(36).slice(2); p.push({ id, xml }); saveParts(p); cb({ status: "succeeded", value: {} }); },
    getByNamespaceAsync(ns, cb) {
      const found = xmlParts().filter((x) => x.xml.includes(ns)).map((x) => ({
        getXmlAsync: (c) => c({ status: "succeeded", value: x.xml }),
        deleteAsync: (c) => { saveParts(xmlParts().filter((y) => y.id !== x.id)); c && c({ status: "succeeded" }); },
      }));
      cb({ status: "succeeded", value: found });
    },
  };
  window.__select = (cc) => { doc.selected = cc; selHandler && selHandler(); };
  window.__text = () => doc.flow.map((x) => x.cc ? (x.cc.kind === "block" ? "\n[KAYNAKÇA]\n" + x.cc.paras.map(runText).join("\n") + "\n" : "{" + x.cc.text + "}") : x.fn ? "[^" + x.fn.controls.map((c) => c.text).join("") + x.fn.text + (x.fn.fields ?? []).map((f) => "<" + f.text + ">").join("") + "]" : x.field ? "<" + x.field.text + ">" : x.text).join("");
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

  // 1b. Office's add-in storage is wiped (cache cleared, add-in re-added): the library comes back from the document.
  await page.waitForFunction(() => (sessionStorage.getItem("__xml") || "").includes("derkenar"), null, { timeout: 10000 });
  await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase("derkenar"); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await page.reload();
  await page.waitForSelector("#message:has-text('geri yüklendi (3 kaynak)')", { timeout: 10000 });

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

  // 2b. Transkripsiyon klavyesi writes where the cursor is.
  await page.click("#translit-toggle");
  await page.click('[data-field="title"]');
  await page.keyboard.press("End");
  await page.click('#translit-keys .tk:has-text("ḥ")');
  if (!(await page.inputValue('[data-field="title"]')).endsWith("ḥ")) fail("transliteration key");
  await page.keyboard.press("Backspace");
  await page.click("#translit-toggle");

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

  // 5. Edit a citation from the cursor. The cursor never pulls the user away from another tab.
  await page.click("#tab-kutuphane");
  await page.evaluate(() => window.__select(window.__doc.flow.filter((x) => x.fn)[2].fn.controls[0]));
  await page.waitForTimeout(600);
  if (await page.isHidden("#view-kutuphane")) fail("cursor in a citation switched away from Kütüphane");
  await page.keyboard.press("Alt+1");
  await page.waitForSelector("#edit-bar:not([hidden])");
  await page.fill('#basket [data-f="locator"]', "99");
  await page.click("#insert");
  await waitNotes(() => window.__notes()[2] === "Gazzâlî, el-Müstasfâ min ʿilmi’l-uṣûl, 2/99.", "edit");
  await page.evaluate(() => window.__select(null));

  // 5a. Delete a citation: remove its works in the edit pane, then "Atıfı sil" — its footnote goes too.
  const count = (await notes()).length;
  await page.evaluate(() => window.__select(window.__doc.flow.filter((x) => x.fn)[3].fn.controls[0]));
  await page.waitForSelector("#edit-bar:not([hidden])");
  while (await page.locator('#basket button[title="Çıkar"]').count()) await page.locator('#basket button[title="Çıkar"]').first().click();
  if (!(await page.isVisible("#basket-section")) || (await page.textContent("#insert")) !== "Atıfı sil") fail("delete button missing after emptying the citation");
  await page.click("#insert");
  await waitNotes(() => true, "");
  await page.waitForSelector("#message:has-text('Atıf ve dipnotu silindi')");
  if ((await notes()).length !== count - 1) fail("footnote not deleted");
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
  // Kısaltmalar listesi: abbreviations of the citations and of the text typed by hand.
  await page.evaluate(() => window.__doc.flow.unshift({ kind: "text", text: "Hz. Peygamber (s.a.v.) buyurdu. " }));
  await page.evaluate(() => (window.__doc.cursor = 1));
  await page.click("#abbreviations");
  await page.waitForSelector("#message:has-text('Kısaltmalar listesi eklendi')");
  const withAbbr = await page.evaluate(() => window.__text());
  if (!withAbbr.includes("# Kısaltmalar") || !/thk\.\tTahkik eden/.test(withAbbr) || !/Hz\.\tHazreti/.test(withAbbr) || !/s\.a\.v\.\tSallallahu/.test(withAbbr)) fail(`abbreviations list: ${withAbbr.slice(0, 600)}`);

  // Divided by kind, and back to one list.
  await page.check("#bib-sections");
  await page.waitForSelector("#message:has-text('türlere ayrıldı')");
  const sections = await page.evaluate(() => window.__text());
  if (!/Kitaplar ve Kitap Bölümleri\n/.test(sections) || !sections.includes("Gazzâlî, Ebû Hâmid Muhammed b. Muhammed. el-Müstasfâ")) fail(`bibliography sections: ${sections}`);
  await page.uncheck("#bib-sections");
  await page.waitForSelector("#message:has-text('tek liste')");
  if ((await page.evaluate(() => window.__text())).includes("Kitaplar ve Kitap Bölümleri")) fail("sections not removed");
  // Kaynakçayı düzenle: leave a cited work out, add an uncited one.
  await page.click("#bib-edit summary");
  await page.locator("#bib-works li", { hasText: "Müstasfâ" }).locator("input").uncheck();
  await page.waitForFunction(() => !window.__text().includes("Gazzâlî, Ebû Hâmid Muhammed b. Muhammed. el-Müstasfâ"));
  await page.locator("#bib-works li", { hasText: "Müstasfâ" }).locator("input").check();
  await page.waitForFunction(() => window.__text().includes("Gazzâlî, Ebû Hâmid Muhammed b. Muhammed. el-Müstasfâ"));
  const bibBefore = await page.evaluate(() => window.__text());
  await page.fill("#bib-add-q", "a");
  const hit = page.locator("#bib-add-hits button").first();
  if (await hit.count()) {
    await hit.click();
    await page.waitForSelector("#message:has-text('atıf yapılmadan')");
    if ((await page.evaluate(() => window.__text())).length <= bibBefore.length) fail("uncited work not in the bibliography");
    await page.locator("#bib-works button", { hasText: "atıfsız" }).first().click();
    await page.waitForFunction((n) => window.__text().length === n, bibBefore.length);
  }
  await page.click("#bib-edit summary");
  if ((await page.locator("#doc-citations li").count()) !== 5) fail("document list should show 5 citations");
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
  await page.waitForSelector("#message:has-text('1 kaynak çevrimiçi kütüphaneye')");
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
  if (Object.keys(stored.edited ?? {}).length) fail(`citations wrongly taken as edited by hand: ${JSON.stringify(stored.edited)}`);

  // 8b. A citation typed over in Word: kept, reported in Denetim, reverted on request.
  await page.evaluate(() => { const fn = window.__doc.flow.filter((x) => x.fn)[1].fn; fn.controls[0].runs = [{ text: "Elle yazılmış atıf.", font: {} }]; });
  await page.click("#tab-belge");
  await page.click("#refresh");
  await page.waitForSelector("#message:has-text('elle değiştirilmiş')");
  if (!(await notes())[1].startsWith("Elle yazılmış")) fail("hand-edited citation overwritten");
  await page.click("#tab-denetim");
  await page.selectOption("#chk-scope", "document");
  await page.click("#chk-run");
  await page.locator("#chk-list button", { hasText: "metnine dön" }).first().click();
  await page.waitForSelector("#message:has-text('metnine döndü')");
  if ((await notes())[1].startsWith("Elle yazılmış")) fail("revert did not rewrite the citation");

  // 9. İSNAD dipnotlu → metin içi: citations alone in a footnote move into the text; back again.
  await page.click("#tab-belge");
  const notesBefore = (await notes()).length;
  const lone = await page.evaluate(() => window.__doc.flow.filter((x) => x.fn && x.fn.controls.length === 1 && !x.fn.text.trim()).length);
  await page.selectOption("#style", "isnad-metinici");
  await page.waitForSelector("#message:has-text('dipnottan metne taşındı')");
  if ((await notes()).length !== notesBefore - lone) fail(`to text: ${notesBefore} → ${(await notes()).length}, lone ${lone}`);
  const inline = await page.evaluate(() => window.__doc.flow.filter((x) => x.cc && x.cc.tag.startsWith("DERKENAR:C:")).map((x) => x.cc.text));
  if (!inline.length || !inline.every((t) => /^\(.+\)$/.test(t))) fail(`in-text citations: ${JSON.stringify(inline)}`);
  await page.selectOption("#style", "isnad-dipnotlu");
  await page.waitForSelector("#message:has-text('dipnota taşındı')");
  if ((await notes()).length !== notesBefore) fail(`back to notes: ${(await notes()).length} vs ${notesBefore}`);
  if (!(await notes()).some((n) => n.startsWith("Ebû Hâmid") || n.startsWith("Ahmet Yılmaz"))) fail("notes not re-rendered");

  // 9b. APA: in-text, no İSNAD abbreviations; back to İSNAD.
  await page.selectOption("#style", "apa");
  await page.waitForSelector("#message:has-text('Stil: APA')");
  const apa = await page.evaluate(() => window.__doc.flow.filter((x) => x.cc && x.cc.tag.startsWith("DERKENAR:C:")).map((x) => x.cc.text));
  if (!apa.length || apa.some((t) => /a\.mlf\.|b\.y\.|y\.y\./.test(t)) || !apa.every((t) => /^\(.+\)$/.test(t))) fail(`APA citations: ${JSON.stringify(apa)}`);
  await page.selectOption("#style", "isnad-dipnotlu");
  await page.waitForSelector("#message:has-text('dipnota taşındı')");

  // 9a. Yeni kaynak: ekleme yolları; RIS metni yapıştırarak ekleme.
  await page.click("#tab-kutuphane");
  await page.selectOption("#lib-new", "__ways");
  if (!(await page.isVisible("#view-yeni")) || (await page.locator("#new-types button").count()) < 8) fail("new-source view");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/yeni.png`, fullPage: true });
  await page.fill("#new-paste", "TY  - BOOK\nAU  - Kara, Mustafa\nTI  - Tasavvuf ve tarikatlar tarihi\nCY  - İstanbul\nPB  - Dergâh Yayınları\nPY  - 1985\nER  - \n");
  await page.click("#new-paste-form button[type=submit]");
  await page.waitForSelector("#message:has-text('1 kaynak eklendi')");
  if (!(await page.isVisible("#view-kaynak"))) fail("pasted record not opened");
  const pastedTitle = await page.inputValue('[data-field="title"]');
  if (pastedTitle !== "Tasavvuf ve Tarikatlar Tarihi") fail(`İSNAD title case on paste: ${pastedTitle}`);
  if (!(await page.textContent("#message")).includes("İSNAD'a göre düzeltildi")) fail("no İSNAD note in the message");
  // A DİA madde: the Atıf box and the printed-volume sentence.
  await page.click("#tab-kutuphane");
  await page.selectOption("#lib-new", "__ways");
  await page.fill("#new-paste", 'MUSTAFA ÇAĞRICI, "GAZZÂLÎ", TDV İslâm Ansiklopedisi, https://islamansiklopedisi.org.tr/gazzali#1 (17.11.2026).\nMaddenin bu bölümü TDV İslâm Ansiklopedisi’nin 1996 yılında İstanbul’da basılan 13. cildinde, 489-505 numaralı sayfalarda yer almıştır.');
  await page.click("#new-paste-form button[type=submit]");
  await page.waitForSelector("#message:has-text('Çağrıcı, Gazzâlî')");
  if ((await page.inputValue('[data-field="pages"]')) !== "489-505") fail("DİA pages");

  // Serbest künye: a list copied from another thesis's bibliography and a footnote.
  await page.click("#tab-kutuphane");
  await page.selectOption("#lib-new", "__ways");
  await page.fill("#new-paste", "Kutlu, Sönmez. Türklerin İslâmlaşma Sürecinde Mürcie ve Tesirleri. Ankara: TDV Yayınları, 2000.\nRecep Eren, Mâtürîdî'nin Müteşâbih Âyetlere Yaklaşımı (Sivas: Cumhuriyet Üniversitesi, Sosyal Bilimler Enstitüsü, Yüksek Lisans Tezi, 2017), 45.\nbu bir künye değil");
  await page.click("#new-paste-form button[type=submit]");
  await page.waitForSelector("#message:has-text('2 kaynak eklendi')");
  if ((await page.inputValue("#new-paste")).trim() !== "bu bir künye değil") fail("unreadable line should stay in the box");
  await page.click("#tab-kutuphane");
  await page.selectOption("#lib-view", "all");
  if (!(await page.locator("#lib-list li.item-row", { hasText: "Müteşâbih Âyetlere" }).count())) fail("free-text thesis not in the library");

  // The same record again: not added twice, the existing one opens.
  await page.click("#tab-kutuphane");
  await page.selectOption("#lib-new", "__ways");
  await page.fill("#new-paste", "TY  - BOOK\nAU  - Kara, Mustafa\nTI  - Tasavvuf ve tarikatlar tarihi\nCY  - İstanbul\nPB  - Dergâh Yayınları\nPY  - 1985\nER  - \n");
  await page.click("#new-paste-form button[type=submit]");

  await page.waitForSelector("#message:has-text('zaten kütüphanede')");
  if (!(await page.isVisible("#view-kaynak"))) fail("existing record not opened");

  // 9c. Merging a cited record into its copy: the document's citations follow the merged record.
  await page.click("#tab-kutuphane");
  await page.selectOption("#lib-view", "all");
  const rowKeys = () => page.$$eval("#lib-list li.item-row", (ls) => ls.filter((l) => l.textContent.includes("Kelâm ilminin doğuşu")).map((l) => l.dataset.key));
  const [origKey] = await rowKeys();
  await page.click(`#lib-list li.item-row[data-key="${origKey}"]`);
  await page.click("#view-kaynak details.menu summary");
  await page.click("#ed-duplicate");
  await page.waitForSelector("#message:has-text('çoğaltıldı')");
  await page.click("#ed-back");
  const copyKey = (await rowKeys()).find((k) => k !== origKey);
  await page.click(`#lib-list li.item-row[data-key="${copyKey}"] input[type=checkbox]`);
  await page.click(`#lib-list li.item-row[data-key="${origKey}"] input[type=checkbox]`);
  await page.click('[data-bulk="merge"]');
  await page.waitForSelector("#message:has-text('birleştirilen kayda bağlandı')");

  // 9d. A document of another citation program: its fields become Derkenar citations.
  await page.evaluate(() => {
    const field = (loc) => ({ code: 'ADDIN ZOTERO_ITEM CSL_CITATION {"citationID":"z' + loc + '","properties":{"plainCitation":"Eski metin ' + loc + '","noteIndex":1},"citationItems":[{"id":1,"uris":["http://zotero.org/users/1/items/ZOTKEY01"],"itemData":{"id":1,"type":"book","title":"Zoteroda Eklenmiş Kitap","author":[{"family":"Ekinci","given":"Selim"}],"issued":{"date-parts":[["2011"]]},"publisher":"Dergâh Yayınları","publisher-place":"İstanbul"},"locator":"' + loc + '","label":"page"}]}', text: "Eski metin " + loc });
    const at = window.__doc.flow.findIndex((x) => x.cc && x.cc.kind === "block");
    window.__doc.flow.splice(at, 0, { fn: { controls: [], text: "", fields: [field("10")] } }, { fn: { controls: [], text: "", fields: [field("11")] } });
  });
  await page.click("#tab-kutuphane");
  await page.click("#tab-belge");
  await page.waitForSelector("#foreign-box:not([hidden])");
  await page.click("#foreign-convert");
  await page.locator("#message", { hasText: "alan Derkenar" }).waitFor();
  const converted = (await notes()).filter((n) => n.includes("Zoteroda Eklenmiş Kitap"));
  if (converted.length !== 2 || !converted[0].startsWith("Selim Ekinci, Zoteroda Eklenmiş Kitap (İstanbul: Dergâh Yayınları, 2011), 10.") || converted[1] !== "Ekinci, Zoteroda Eklenmiş Kitap, 11.") fail(`converted fields: ${JSON.stringify(converted)}`);

  // 9e. Atıf kalıbı: a series of works saved by name and called back into the basket.
  await page.click("#tab-atif");
  await page.evaluate(() => (window.__doc.cursor = window.__doc.flow.length));
  await page.fill("#q", "yilmaz 50");
  await page.press("#q", "Enter");
  await page.fill("#q", "kemalpasazade");
  await page.press("#q", "Enter");
  if ((await page.locator("#basket > li").count()) !== 2) fail("basket for the template");
  await page.click("#tpl-save-open");
  await page.fill("#tpl-name", "Deneme tahrîci");
  await page.click("#tpl-form button[type=submit]");
  await page.waitForSelector("#message:has-text('kalıbı kaydedildi')");
  await page.click("#clear-basket");
  await page.click("#tpl-box summary");
  await page.locator("#tpl-list button", { hasText: "Deneme tahrîci" }).click();
  if ((await page.locator("#basket > li").count()) !== 2) fail("template did not fill the basket");
  if ((await page.inputValue('#basket li:first-child [data-f="locator"]')) !== "50") fail("template lost the page");
  await page.click("#clear-basket");

  // 9f. A style loaded from a .csl file; a dependent style is refused; back to İSNAD.
  await page.click("#tab-belge");
  await page.setInputFiles("#csl-file", { name: "nature-communications.csl", mimeType: "application/xml", buffer: await readFile(new URL("../test/fixtures/csl/nature-communications.csl", import.meta.url)) });
  await page.waitForSelector("#message:has-text('bağımlı')");
  await page.setInputFiles("#csl-file", { name: "mla.csl", mimeType: "application/xml", buffer: await readFile(new URL("../test/fixtures/csl/modern-language-association.csl", import.meta.url)) });
  await page.locator("#message", { hasText: "Stil: MLA Handbook" }).waitFor();
  const mla = await page.evaluate(() => window.__doc.flow.filter((x) => x.cc && x.cc.tag.startsWith("DERKENAR:C:")).map((x) => x.cc.text));
  if (!mla.length || mla.some((t) => /a\.mlf\.|b\.y\./.test(t))) fail(`MLA citations: ${JSON.stringify(mla)}`);
  const stored2 = JSON.parse(await page.evaluate(() => window.__doc.settings.derkenar));
  if (!stored2.customStyle?.xml?.includes("Modern Language Association")) fail("custom style not kept in the document");
  await page.click("#csl-remove");
  await page.waitForSelector("#message:has-text('listeden kaldırıldı')");

  // 9g. Restore points: take one, break a record, go back to it.
  await page.click("#go-info");
  await page.click("#snap-now");
  await page.waitForSelector("#message:has-text('şimdiki hâli saklandı')");
  const brokenKey = await page.evaluate(() => document.querySelectorAll("#snap-list li").length);
  if (brokenKey < 1) fail("restore point not listed");
  await page.click("#tab-kutuphane");
  await page.selectOption("#lib-view", "all");
  await page.locator("#lib-list li.item-row", { hasText: "Zoteroda Eklenmiş Kitap" }).first().click();
  await page.fill('[data-field="title"]', "Bozulmuş başlık");
  await page.waitForTimeout(800);
  await page.click("#go-info");
  const firstSnap = page.locator("#snap-list li", { hasText: "elle" }).first().locator("button", { hasText: "Bu güne dön" });
  await firstSnap.click();
  await page.locator("#snap-list li", { hasText: "elle" }).first().locator("button", { hasText: "Emin misiniz" }).click();
  await page.waitForSelector("#message:has-text('hâline döndü')");
  await page.click("#tab-kutuphane");
  if (!(await page.locator("#lib-list li.item-row", { hasText: "Zoteroda Eklenmiş Kitap" }).count())) fail("restore did not bring the title back");

  // 10. Veri bilgisi ve kılavuz.
  await page.click("#go-info");
  await page.waitForSelector("#info-document dd:has-text('kaynak,')");
  const facts = await page.textContent("#info-library");
  if (!/Kaynak\s*[1-9]/.test(facts)) fail(`data info: ${facts}`);
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/veri.png`, fullPage: true });
  if (!(await page.textContent("#info-types")).trim()) fail("data info: no item types");
  await page.click("#go-help");
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/kilavuz.png`, fullPage: true });
  if (!(await page.isVisible("#view-yardim")) || !(await page.textContent("#about-version")).trim()) fail("guide view");
  await page.click("#tab-belge");

  await page.click("#unlink");
  await page.click("#unlink");
  await page.waitForSelector("#message:has-text('düz metne çevrildi')");

  const unexpected = errors.filter((e) => !/bağımlı\) bir stil/.test(e));
  if (unexpected.length) fail(`page errors: ${unexpected.join(" | ")}`);
  console.log("smoke ok");
} finally {
  await browser.close();
  server.close();
}
