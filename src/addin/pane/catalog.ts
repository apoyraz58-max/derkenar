/**
 * Şamile kataloğu (and the works added from OpenITI): it comes with the add-in
 * (catalog/catalog.json.gz, the reviewed entries) and is read on first need;
 * a newer catalog file (.json) can still be imported, kept in this computer's
 * storage, and is used instead. In the Atıf tab a search shows the catalog's
 * books; one click adds the İSNAD record (DİA names, transcribed title, its
 * source) and puts it in the citation.
 */
import { gunzipSync, strFromU8 } from "fflate";
import { type Catalog, type CatalogEntry, SHAMELA, catalogItem, searchCatalog } from "../../core/shamela.js";
import { getMeta, setMeta } from "../store.js";
import { $, run, setMessage } from "./core.js";

/** A catalog file imported on this computer; when there is one it is used instead of the built-in one. */
let catalog: Catalog | null = null;
/** The catalog that comes with the add-in. */
let builtin: Catalog | null = null;

function render(): void {
  const c = catalog ?? builtin;
  $("catalog-status").textContent = c ? `${c.name}: ${c.entries.length.toLocaleString("tr-TR")} eser (${catalog ? `yüklenen dosya: ${c.source}` : c.source}).` : "Katalog okunuyor…";
  $("catalog-remove").hidden = !catalog;
}

async function loadBuiltin(): Promise<void> {
  const r = await fetch("catalog/catalog.json.gz");
  if (!r.ok) throw new Error(`Katalog okunamadı (${r.status}).`);
  builtin = JSON.parse(strFromU8(gunzipSync(new Uint8Array(await r.arrayBuffer())))) as Catalog;
  render();
}

export async function loadCatalog(): Promise<void> {
  catalog = (await getMeta<Catalog>("catalog").catch(() => undefined)) ?? null;
  render();
  // The built-in catalog (about 1 MB) is read in the background; a search before it is ready shows the library only.
  void loadBuiltin().catch(() => {
    if (!catalog) $("catalog-status").textContent = "Derkenar'ın kataloğu okunamadı.";
  });
}

/** The catalog file: {name, source, entries} or a bare list of entries. */
export function readCatalog(text: string, fileName: string): Catalog {
  const data = JSON.parse(text) as Catalog | CatalogEntry[];
  const entries = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(entries) || !entries.length || !entries.every((e) => typeof e.id === "number" && typeof e.title === "string")) throw new Error("Bu dosya bir katalog dosyası değil.");
  return { name: (!Array.isArray(data) && data.name) || SHAMELA, source: (!Array.isArray(data) && data.source) || `${fileName}, ${new Date().toLocaleDateString("tr-TR")}`, entries };
}

export function wireCatalog(): void {
  const input = $<HTMLInputElement>("catalog-file");
  input.onchange = () =>
    void run("Katalog okunuyor", async () => {
      const f = input.files?.[0];
      input.value = "";
      if (!f) return;
      catalog = readCatalog(await f.text(), f.name);
      await setMeta("catalog", catalog);
      render();
      const review = catalog.entries.filter((e) => e.review?.length).length;
      setMessage(`${catalog.name} kataloğu yüklendi: ${catalog.entries.length.toLocaleString("tr-TR")} eser${review ? ` (${review} eserin okunuşu ya da müellifi kontrol için işaretli)` : ""}. Atıf sekmesinde aradığınızda bu eserler de çıkar.`, "success");
    });
  $("catalog-remove").onclick = () =>
    void run("Kaldırılıyor", async () => {
      catalog = null;
      await setMeta("catalog", null);
      render();
      setMessage("Yüklenen katalog kaldırıldı; Derkenar'ın kendi kataloğu kullanılıyor. Kütüphaneye eklenmiş eserler yerinde.", "info");
    });
}

/** Catalog books for the Atıf search, as records ready to add. */
export function catalogHits(q: string, limit = 5): { entry: CatalogEntry; item: () => ReturnType<typeof catalogItem>; catalog: string }[] {
  const c = catalog ?? builtin;
  if (!c || q.trim().length < 3) return [];
  const name = c.name;
  return searchCatalog(q, c, limit).map((entry) => ({ entry, item: () => catalogItem(entry, name), catalog: name }));
}
