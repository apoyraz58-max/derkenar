/**
 * Şamile kataloğu (and later others): imported once from the prepared catalog
 * file (.json), kept in this computer's storage like the Şahıslar table. In
 * the Atıf tab a search shows the catalog's books; one click adds the İSNAD
 * record (DİA names, transcribed title, its source) and puts it in the citation.
 */
import { type Catalog, type CatalogEntry, SHAMELA, catalogItem, searchCatalog } from "../../core/shamela.js";
import { getMeta, setMeta } from "../store.js";
import { $, run, setMessage } from "./core.js";

let catalog: Catalog | null = null;

function render(): void {
  $("catalog-status").textContent = catalog ? `${catalog.name}: ${catalog.entries.length.toLocaleString("tr-TR")} eser yüklü (${catalog.source}).` : "Katalog yüklü değil.";
  $("catalog-remove").hidden = !catalog;
}

export async function loadCatalog(): Promise<void> {
  catalog = (await getMeta<Catalog>("catalog").catch(() => undefined)) ?? null;
  render();
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
      setMessage("Katalog kaldırıldı; kütüphaneye eklenmiş eserler yerinde.", "info");
    });
}

/** Catalog books for the Atıf search, as records ready to add. */
export function catalogHits(q: string, limit = 5): { entry: CatalogEntry; item: () => ReturnType<typeof catalogItem>; catalog: string }[] {
  if (!catalog || q.trim().length < 3) return [];
  const name = catalog.name;
  return searchCatalog(q, catalog, limit).map((entry) => ({ entry, item: () => catalogItem(entry, name), catalog: name }));
}
