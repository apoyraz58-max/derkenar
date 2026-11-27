/**
 * Veri bilgisi: what the library holds, where it is kept, what this document
 * carries (citations, library copy) and which components render the output.
 */
import { SCHEMA_VERSION, isNoteItem, itemTypeLabel } from "../../core/zotero.js";
import { getMeta } from "../store.js";
import * as word from "../word.js";
import { $, S, doc, download, h, restoreSnapshot, run, setMessage, snapshotBackup, snapshots, styleTitle, takeSnapshot } from "./core.js";
import { citedKeys } from "./document.js";
import { sourceName } from "./io.js";

declare const __VERSION__: string;

const n = (x: number) => x.toLocaleString("tr-TR");
const size = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }) : "—");

function facts(id: string, rows: [string, string][]): void {
  $(id).replaceChildren(...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
}

export async function renderInfo(): Promise<void> {
  const live = S.items.filter((i) => !i.deleted);
  const works = live.filter((i) => !isNoteItem(i));
  const notes = live.reduce((a, i) => a + i.notes.length, 0) + live.length - works.length;
  const attachments = live.reduce((a, i) => a + (i.attachments?.length ?? 0), 0);
  const tags = new Set(live.flatMap((i) => i.tags.map((t) => t.tag)));
  const dirty = live.filter((i) => i.dirty).length;
  facts("info-library", [
    ["Kaynak", n(works.length)],
    ["Not", n(notes)],
    ["Ek (dosya, bağlantı)", n(attachments)],
    ["Koleksiyon", n(S.collections.length)],
    ["Kayıtlı arama", n(S.searches.length)],
    ["Etiket", n(tags.size)],
    ["Çöp kutusunda", n(S.items.length - live.length)],
    ["Çevrimiçi kütüphaneye gönderilmemiş değişiklik", n(dirty)],
  ]);

  const byType = new Map<string, number>();
  for (const i of works) byType.set(i.itemType, (byType.get(i.itemType) ?? 0) + 1);
  $("info-types").replaceChildren(...[...byType].sort((a, b) => b[1] - a[1]).map(([t, c]) => h("li", {}, `${itemTypeLabel(t)}: ${n(c)}`)));
  if (!byType.size) $("info-types").append(h("li", { class: "muted" }, "Kütüphane boş."));

  const bySource = new Map<string, number>();
  for (const i of works) bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);
  $("info-sources").replaceChildren(...[...bySource].sort((a, b) => b[1] - a[1]).map(([s, c]) => h("li", {}, `${sourceName(s)}: ${n(c)}`)));

  const d = doc();
  const cited = citedKeys();
  const missing = [...cited].filter((k) => !S.byKey.has(k)).length;
  const docRows: [string, string][] = [
    ["Atıf stili", styleTitle(d.style)],
    ["Dil", d.locale === "en-US" ? "İngilizce" : "Türkçe"],
    ["Atıf yeri", d.notes === "endnote" ? "Sonnot" : "Dipnot"],
    ["Atıf", n(Object.keys(d.citations).length)],
    ["Atıf yapılan kaynak", n(cited.size) + (missing ? ` (${n(missing)} tanesi kütüphanede yok)` : "")],
    ["Kaynakça", d.bibliographyHtml ? "Var" : "Yok"],
    ["Otomatik güncelleme", d.auto === false ? "Kapalı" : "Açık"],
  ];
  facts("info-document", [...docRows, ["Kütüphane kopyası", "Okunuyor…"]]);
  const copyRow = await libraryCopyRow(d.keepLibrary !== false);
  facts("info-document", [...docRows, ["Kütüphane kopyası", copyRow]]);

  const storage: [string, string][] = [];
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage !== undefined) storage.push(["Eklenti deposu", size(est.usage) + (est.quota ? ` / ${size(est.quota)}` : "")]);
    const persisted = await navigator.storage?.persisted?.();
    if (persisted !== undefined) storage.push(["Kalıcı depo", persisted ? "Evet (tarayıcı silmez)" : "Hayır (disk dolarsa silinebilir)"]);
  } catch {
    /* not available inside this Office */
  }
  const z = await getMeta<{ mode: string; kind: string; id: string }>("zotero").catch(() => undefined);
  const zv = await getMeta<{ library: string; version: number }>("zoteroVersion").catch(() => undefined);
  storage.push(["Çevrimiçi kütüphane", z ? (z.mode === "local" ? "Bu bilgisayardaki atıf programı" : `${z.kind === "groups" ? "grup" : "kişisel"} ${z.id}`) : "Yok"]);
  if (zv) storage.push(["Son eşitleme", `${zv.library}, sürüm ${zv.version}`]);
  facts("info-storage", storage);

  void renderSnapshots();
  facts("info-components", [
    ["Künye", __VERSION__],
    ["Biçimlendirici", "citeproc-js (CSL)"],
    ["Stiller", "İSNAD 2 dipnotlu, İSNAD 2 metin içi (resmî CSL, Künye düzeltmeleriyle)"],
    ["Kaynak türleri şeması", `sürüm ${SCHEMA_VERSION}`],
    ["Word API", Office.context?.requirements?.isSetSupported?.("WordApi", "1.5") ? "1.5 ve üstü (dipnot, sonnot)" : "1.3 (dipnotlar sınırlı)"],
  ]);
}

async function libraryCopyRow(keep: boolean): Promise<string> {
  try {
    const xml = await word.readLibraryCopy();
    if (!xml) return keep ? "Henüz yazılmadı" : "Kapalı";
    const { unpackLibrary } = await import("../../core/librarycopy.js");
    const copy = unpackLibrary(xml);
    if (!copy) return `Okunamadı (${size(xml.length)})`;
    const k = copy.items.filter((i) => !i.deleted).length;
    return `${n(k)} kaynak, ${size(xml.length)}, ${when(copy.saved)}${keep ? "" : " (artık güncellenmiyor)"}`;
  } catch {
    return "Okunamadı";
  }
}

// ---------------------------------------------------------------- restore points

let armed = "";

export async function renderSnapshots(): Promise<void> {
  const list = await snapshots();
  const label = (r: string) => (r === "daily" ? "günlük" : r === "manual" ? "elle" : r === "before-fix" ? "toplu düzeltmeden önce" : r === "before-import" ? "içe aktarmadan önce" : "geri yüklemeden önce");
  $("snap-list").replaceChildren(
    ...list.map((sn) =>
      h(
        "li",
        {},
        `${when(sn.saved)} · ${n(sn.count)} kaynak · ${label(sn.reason)} `,
        h("button", {
          type: "button",
          class: "link",
          onclick: (e: Event) => {
            const b = e.target as HTMLButtonElement;
            if (armed !== sn.saved) {
              armed = sn.saved;
              b.textContent = "Emin misiniz? Tekrar tıklayın";
              window.setTimeout(() => {
                if (armed === sn.saved) armed = "";
                b.textContent = "Bu güne dön";
              }, 4000);
              return;
            }
            armed = "";
            void run("Geri yükleniyor", async () => {
              const r = await restoreSnapshot(sn.saved);
              setMessage(`Kütüphane ${when(sn.saved)} hâline döndü (${n(r.count)} kaynak).${r.trashed ? ` Sonra eklenen ${n(r.trashed)} kaynak çöp kutusunda.` : ""} Geri almak için listedeki "geri yüklemeden önce" noktasını kullanın.`, "success");
              await renderInfo();
            });
          },
        }, "Bu güne dön"),
        " · ",
        h("button", {
          type: "button",
          class: "link",
          onclick: () =>
            void run("Hazırlanıyor", async () => {
              download(`derkenar-yedek-${sn.saved.slice(0, 10)}.json`, await snapshotBackup(sn.saved));
            }),
        }, "İndir"),
      ),
    ),
  );
  if (!list.length) $("snap-list").append(h("li", { class: "muted" }, "Henüz yok; kütüphanede kaynak varken her gün bir tane oluşur."));
}

export function wireInfo(): void {
  $("snap-now").onclick = () =>
    void run("Saklanıyor", async () => {
      await takeSnapshot("manual");
      await renderSnapshots();
      setMessage("Kütüphanenin şimdiki hâli saklandı.", "success");
    });
}
