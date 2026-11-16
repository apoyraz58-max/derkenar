/**
 * Aktar: Zotero exports and the Zotero API in, DOI/ISBN lookups, exports out,
 * and the list of where the library's items came from.
 */
import { backup, cslJson, formatAs, isBackup, parseBackup } from "../../core/exporters.js";
import { type ZoteroConfig, cleanArxiv, cleanDoi, cleanIsbn, cleanPmid, detectFormat, lookupArxiv, lookupDoi, lookupIsbn, lookupPmid, parseFile, pushToZotero, syncZotero } from "../../core/importers.js";
import { report, zoteroCsv, zoteroRdf } from "../../core/zoteroexport.js";
import { type Collection, type Item, creatorLine, now, titleOf } from "../../core/zotero.js";
import { citedKeys } from "./document.js";
import { getMeta, setMeta } from "../store.js";
import { $, S, copyText, doc, download, h, putCollections, putItems, run, setMessage } from "./core.js";
import { openEditor } from "./editor.js";
import { currentView, inCurrentView } from "./library.js";


/** Imports keep existing items: a re-import of the same Zotero export updates them in place. */
async function importItems(items: Item[], collections: Collection[]): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  const t = now();
  const merged = items.map((i) => {
    const old = S.byKey.get(i.key);
    if (!old) {
      added++;
      return i;
    }
    updated++;
    return { ...i, dateAdded: old.dateAdded, dateModified: t, collections: [...new Set([...old.collections, ...i.collections])] };
  });
  if (collections.length) await putCollections(collections);
  await putItems(merged);
  return { added, updated };
}

async function importFiles(files: File[]): Promise<void> {
  let added = 0;
  let updated = 0;
  let colls = 0;
  for (const f of files) {
    const text = await f.text();
    if (isBackup(text)) {
      const b = parseBackup(text);
      const r = await importItems(b.items, b.collections);
      added += r.added;
      updated += r.updated;
      colls += b.collections.length;
      continue;
    }
    const r = await parseFile(text, f.name);
    const x = await importItems(r.items, r.collections);
    added += x.added;
    updated += x.updated;
    colls += r.collections.length;
  }
  setMessage(`${added} kaynak eklendi${updated ? `, ${updated} kaynak güncellendi` : ""}${colls ? `, ${colls} koleksiyon alındı` : ""}.`, "success");
}

/** Adds records pasted as RIS, BibTeX or CSL JSON text. */
async function pasteRecords(): Promise<void> {
  const box = $<HTMLTextAreaElement>("new-paste");
  const text = box.value.trim();
  if (!text) throw new Error("RIS, BibTeX ya da CSL JSON metnini yapıştırın.");
  if (detectFormat(text) === "unknown") throw new Error("Metin tanınmadı. RIS satırları \"TY  - \" ile, BibTeX kayıtları \"@book{\" gibi, CSL JSON \"[\" ya da \"{\" ile başlar.");
  const r = await parseFile(text, "yapıştırılan");
  if (!r.items.length) throw new Error("Metinde kaynak bulunamadı.");
  const v = currentView();
  const items = r.items.map((i) => ({ ...i, source: "manual", collections: v.kind === "collection" ? [v.key] : i.collections }));
  await putItems(items);
  box.value = "";
  setMessage(`${items.length} kaynak eklendi${items.length === 1 ? `: ${creatorLine(items[0]!)}, ${titleOf(items[0]!)}` : ""}.`, "success");
  if (items.length === 1) openEditor(items[0]!.key);
}

function zoteroConfig(): ZoteroConfig {
  const local = $<HTMLSelectElement>("z-mode").value === "local";
  const id = $<HTMLInputElement>("z-id").value.trim();
  const apiKey = $<HTMLInputElement>("z-key").value.trim();
  if (!local && !/^\d+$/.test(id)) throw new Error("Kullanıcı veya grup numarasını yazın (yalnız rakam).");
  return local ? { library: "users/0", base: "http://localhost:23119/api" } : { library: `${$<HTMLSelectElement>("z-kind").value}/${id}`, apiKey: apiKey || undefined };
}

async function syncFromZotero(): Promise<void> {
  const local = $<HTMLSelectElement>("z-mode").value === "local";
  const id = $<HTMLInputElement>("z-id").value.trim();
  const apiKey = $<HTMLInputElement>("z-key").value.trim();
  const cfg = zoteroConfig();
  const saved = await getMeta<{ library: string; base?: string; version: number }>("zoteroVersion");
  const since = saved && saved.library === cfg.library && saved.base === cfg.base ? saved.version : 0;
  const status = $("z-status");
  const page = await syncZotero(cfg, since, fetch, (done, total) => (status.textContent = `${done} / ${total}`)).catch((e: unknown) => {
    if (local && e instanceof TypeError) throw new Error("Bu bilgisayardaki atıf programına ulaşılamadı: program açık mı, yerel API izni verildi mi?");
    throw e;
  });
  const source = `zotero:${cfg.library}`;
  // Edits made in Derkenar and not yet sent are kept unless Zotero changed the item too.
  const conflicts: string[] = [];
  const items = page.items.map((i) => {
    const old = S.byKey.get(i.key);
    if (!old?.dirty) return i;
    if (old.version === i.version) return old;
    conflicts.push(i.fields.title ?? i.key);
    return { ...i, attachments: old.attachments };
  });
  const stale = since === 0 ? S.items.filter((i) => i.source === source && !page.items.some((p) => p.key === i.key)).map((i) => i.key) : [];
  await putCollections(page.collections);
  await putItems(items, [...stale, ...page.deletedKeys]);
  await setMeta("zoteroVersion", { library: cfg.library, base: cfg.base, version: page.version });
  const known = new Set((await getMeta<string[]>("zoteroCollections")) ?? []);
  for (const c of page.collections) known.add(c.key);
  await setMeta("zoteroCollections", [...known]);
  await setMeta("zotero", { mode: local ? "local" : "web", kind: $<HTMLSelectElement>("z-kind").value, id, apiKey });
  status.textContent = `Son eşitleme: ${new Date().toLocaleString("tr-TR")}`;
  const msg = since ? `${page.items.length} değişen, ${page.deletedKeys.length} silinen kaynak işlendi.` : `${page.items.length} kaynak ve ${page.collections.length} koleksiyon çevrimiçi kütüphaneden alındı.`;
  setMessage(conflicts.length ? `${msg} ${conflicts.length} kaynak hem Derkenar'da hem çevrimiçi kütüphanede değişmişti; çevrimiçi hâli alındı: ${conflicts.slice(0, 3).join("; ")}${conflicts.length > 3 ? "…" : ""}` : msg, conflicts.length ? "warning" : "success");
  renderPushCount();
}

/** Sends Derkenar's changes (and, if asked, items entered here) to the Zotero library. */
async function pushChanges(): Promise<void> {
  const cfg = zoteroConfig();
  if (!cfg.base && !cfg.apiKey) throw new Error("Göndermek için yazma izni olan bir API anahtarı gerekir.");
  const source = `zotero:${cfg.library}`;
  const includeNew = $<HTMLInputElement>("z-push-new").checked;
  const items = S.items.filter((i) => !i.deleted && ((i.source === source && i.dirty) || (includeNew && !i.source.startsWith("zotero:") && i.source !== "belge")));
  if (!items.length) {
    setMessage("Çevrimiçi kütüphaneye gönderilecek değişiklik yok.", "info");
    return;
  }
  const known = new Set((await getMeta<string[]>("zoteroCollections")) ?? []);
  const res = await pushToZotero(cfg, items, known);
  await putItems(res.saved);
  const saved = await getMeta<{ library: string; base?: string; version: number }>("zoteroVersion");
  if (saved && saved.library === cfg.library && res.version) await setMeta("zoteroVersion", { ...saved, version: Math.max(saved.version, res.version) });
  renderPushCount();
  setMessage(`${res.saved.length} kaynak çevrimiçi kütüphaneye gönderildi.${res.failed.length ? ` ${res.failed.length} kaynak gönderilemedi: ${res.failed[0]!.message}` : ""}`, res.failed.length ? "warning" : "success");
}

export function renderPushCount(): void {
  const n = S.items.filter((i) => i.dirty && !i.deleted).length;
  $("z-push-count").textContent = n ? `${n} değişiklik gönderilmeyi bekliyor.` : "";
}

/**
 * Turkish publishers often put the ISBN into the DOI (10.70458/fcr.9786258910605)
 * and do not always register it. When the DOI is not found, the ISBN inside it is tried.
 */
async function lookupDoiOrIsbn(doi: string): Promise<Item> {
  try {
    return await lookupDoi(doi);
  } catch (e) {
    const isbn = /97[89]\d{10}/.exec(doi.replace(/-/g, ""))?.[0];
    if (!isbn) throw e;
    try {
      const item = await lookupIsbn(isbn);
      item.fields.DOI = doi;
      return item;
    } catch {
      throw new Error(`${e instanceof Error ? e.message : String(e)} DOI'deki ISBN (${isbn}) ile de bulunamadı; kitabı elle girin (Yeni Kaynak → Kitap).`);
    }
  }
}

async function lookup(box = "lookup"): Promise<void> {
  const lines = $<HTMLTextAreaElement>(box).value.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error("DOI (10.xxxx/…), ISBN, PMID veya arXiv numarası yazın.");
  const found: Item[] = [];
  const failed: string[] = [];
  const reasons: string[] = [];
  for (const line of lines) {
    const doi = cleanDoi(line);
    const arxiv = doi ? null : cleanArxiv(line);
    const pmid = doi || arxiv ? null : cleanPmid(line);
    const isbn = doi || arxiv || pmid ? null : cleanIsbn(line);
    try {
      if (doi) found.push(await lookupDoiOrIsbn(doi));
      else if (arxiv) found.push(await lookupArxiv(arxiv));
      else if (pmid) found.push(await lookupPmid(pmid));
      else if (isbn) found.push(await lookupIsbn(isbn));
      else {
        failed.push(line);
        reasons.push(`"${line}" DOI, ISBN, PMID ya da arXiv numarası olarak tanınmadı.`);
      }
    } catch (e) {
      failed.push(line);
      reasons.push(e instanceof Error ? e.message : String(e));
    }
  }
  const v = currentView();
  if (v.kind === "collection") for (const f of found) f.collections = [v.key];
  await putItems(found);
  $<HTMLTextAreaElement>(box).value = failed.join("\n");
  if (!found.length) throw new Error(reasons.join(" "));
  setMessage(`${found.length} kaynak eklendi${found.length === 1 ? `: ${creatorLine(found[0]!)}, ${titleOf(found[0]!)}` : ""}.${failed.length ? ` Eklenemeyen ${failed.length} satır kutuda bırakıldı: ${reasons.join(" ")}` : ""}`, failed.length ? "warning" : "success");
  // One work found: open it, so it can be checked and completed at once.
  if (found.length === 1) openEditor(found[0]!.key);
}

function exportScope(): Item[] {
  const scope = $<HTMLSelectElement>("ex-scope").value;
  if (scope === "collection") return S.items.filter(inCurrentView);
  if (scope === "selected") return [...S.selected].map((k) => S.byKey.get(k)).filter((x): x is Item => Boolean(x));
  if (scope === "document") return [...citedKeys()].map((k) => S.byKey.get(k) ?? doc().items[k]).filter((x): x is Item => Boolean(x));
  return S.items.filter((i) => !i.deleted);
}

async function exportText(): Promise<{ name: string; text: string; type: string }> {
  const items = exportScope();
  if (!items.length) throw new Error("Dışa aktarılacak kaynak yok.");
  const date = new Date().toISOString().slice(0, 10);
  switch ($<HTMLSelectElement>("ex-format").value) {
    case "backup": {
      const keys = new Set(items.flatMap((i) => i.collections));
      return { name: `derkenar-yedek-${date}.json`, text: backup(items, S.collections.filter((c) => keys.has(c.key) || $<HTMLSelectElement>("ex-scope").value === "library")), type: "application/json" };
    }
    case "rdf": {
      const keys = new Set(items.flatMap((i) => i.collections));
      return { name: `derkenar-${date}.rdf`, text: zoteroRdf(items, S.collections.filter((c) => keys.has(c.key))), type: "application/rdf+xml" };
    }
    case "csv":
      return { name: `derkenar-${date}.csv`, text: zoteroCsv(items), type: "text/csv" };
    case "report":
      return { name: `derkenar-rapor-${date}.html`, text: report(items, S.collections), type: "text/html" };
    case "csl":
      return { name: `derkenar-${date}.json`, text: cslJson(items), type: "application/json" };
    case "ris":
      return { name: `derkenar-${date}.ris`, text: await formatAs(items, "ris"), type: "application/x-research-info-systems" };
    default:
      return { name: `derkenar-${date}.bib`, text: await formatAs(items, "bibtex"), type: "application/x-bibtex" };
  }
}

export function renderSources(): void {
  const counts = new Map<string, number>();
  for (const i of S.items) if (!i.deleted) counts.set(i.source, (counts.get(i.source) ?? 0) + 1);
  $("sources").replaceChildren(
    ...[...counts].sort().map(([source, n]) =>
      h(
        "li",
        {},
        h("span", {}, `${sourceName(source)} — ${n}`),
        h("button", {
          type: "button",
          class: "link",
          onclick: () =>
            void run("Çöpe taşınıyor", async () => {
              await putItems(S.items.filter((i) => i.source === source).map((i) => ({ ...i, deleted: true, dateModified: now() })), [], true);
              setMessage(`${sourceName(source)} kaynakları çöp kutusuna taşındı.`, "success");
            }),
        }, "Çöpe at"),
      ),
    ),
  );
}

export function sourceName(source: string): string {
  if (source.startsWith("zotero:")) return `Çevrimiçi kütüphane (${source.slice(7)})`;
  if (source.startsWith("file:")) return `Dosya: ${source.slice(5)}`;
  return ({ doi: "DOI ile eklenenler", isbn: "ISBN ile eklenenler", manual: "Elle girilenler", belge: "Belgelerden alınanlar" } as Record<string, string>)[source] ?? source;
}

export async function restoreZoteroForm(): Promise<void> {
  const z = await getMeta<{ mode: string; kind: string; id: string; apiKey: string }>("zotero");
  if (!z) return;
  $<HTMLSelectElement>("z-mode").value = z.mode;
  $<HTMLSelectElement>("z-kind").value = z.kind;
  $<HTMLInputElement>("z-id").value = z.id;
  $<HTMLInputElement>("z-key").value = z.apiKey;
  $<HTMLSelectElement>("z-mode").dispatchEvent(new Event("change"));
}

export function wireIo(): void {
  const mode = $<HTMLSelectElement>("z-mode");
  mode.onchange = () => {
    for (const el of document.querySelectorAll<HTMLElement>(".web-only")) el.hidden = mode.value === "local";
    for (const el of document.querySelectorAll<HTMLElement>(".local-only")) el.hidden = mode.value !== "local";
  };
  $("z-push").onclick = () => void run("Gönderiliyor", pushChanges);
  $<HTMLFormElement>("zotero-form").onsubmit = (e) => {
    e.preventDefault();
    void run("Eşitleniyor", syncFromZotero);
  };
  $<HTMLInputElement>("file").onchange = () =>
    void run("İçe aktarılıyor", async () => {
      await importFiles([...($<HTMLInputElement>("file").files ?? [])]);
      $<HTMLInputElement>("file").value = "";
    });
  $<HTMLFormElement>("lookup-form").onsubmit = (e) => {
    e.preventDefault();
    void run("Aranıyor", lookup);
  };
  // Yeni kaynak: the same ways of adding, in one place.
  $<HTMLFormElement>("new-lookup-form").onsubmit = (e) => {
    e.preventDefault();
    void run("Aranıyor", () => lookup("new-lookup"));
  };
  $<HTMLFormElement>("new-paste-form").onsubmit = (e) => {
    e.preventDefault();
    void run("Ekleniyor", pasteRecords);
  };
  $<HTMLInputElement>("new-file").onchange = () =>
    void run("İçe aktarılıyor", async () => {
      await importFiles([...($<HTMLInputElement>("new-file").files ?? [])]);
      $<HTMLInputElement>("new-file").value = "";
    });
  $("ex-download").onclick = () =>
    void run("Hazırlanıyor", async () => {
      const x = await exportText();
      download(x.name, x.text, x.type);
      setMessage(`${x.name} hazırlandı. İndirme başlamadıysa "Panoya kopyala"yı kullanın.`, "success");
    });
  $("ex-copy").onclick = () =>
    void run("Hazırlanıyor", async () => {
      const x = await exportText();
      await copyText(x.text);
      setMessage("Panoya kopyalandı.", "success");
    });
}
