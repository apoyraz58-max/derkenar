/**
 * Şahıslar tablosu (DİA – EI3): imported once from the user's own .xlsx /
 * .csv, kept in this computer's storage. With it, English İSNAD writes the
 * names of these persons the EI3 way and Turkish records are checked against
 * DİA's spelling. (Death dates in the text are Vefeyât's work.)
 */
import { setEnglishNames } from "../../core/docstate.js";
import { type PersonIndex, type PersonTable, diaParts, ei3Replacements, diaSuggestion, englishCreator, findPerson, indexPersons, onlyMarks, searchPersons, tableFrom } from "../../core/persons.js";
import type { Issue } from "../../core/isnad.js";
import type { Item } from "../../core/zotero.js";
import * as word from "../word.js";
import { getMeta, setMeta } from "../store.js";
import { $, doc, run, serial, setMessage } from "./core.js";
import { refresh } from "./document.js";

let index: PersonIndex | null = null;

function use(table: PersonTable | null): void {
  index = table ? indexPersons(table) : null;
  setEnglishNames(
    index
      ? (c) => {
          const p = findPerson(c, index!);
          if (!p) return c;
          return englishCreator(c, p, index!.table.dict).creator;
        }
      : null,
  );
  render();
}

function render(): void {
  const t = index?.table;
  $("persons-status").textContent = t ? `${t.persons.length.toLocaleString("tr-TR")} kişi yüklü (${t.source}).` : "Tablo yüklü değil.";
  $("persons-remove").hidden = !t;
  $("person-helper").hidden = false;
  $("person-empty").hidden = Boolean(t);
  $<HTMLButtonElement>("person-ei3").disabled = !t;
}

export async function loadPersons(): Promise<void> {
  use((await getMeta<PersonTable>("persons").catch(() => undefined)) ?? null);
}

const english = () => /^en/.test(doc().locale);

async function importTable(file: File): Promise<void> {
  const table = await tableFrom({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  await setMeta("persons", table);
  use(table);
  const unsure = table.persons.filter((p) => p.unsure).length;
  if (english()) await refresh(false, true);
  setMessage(`Şahıslar tablosu yüklendi: ${table.persons.length.toLocaleString("tr-TR")} kişi${unsure ? ` (${unsure} kişinin EI3 yazımı tabloda tahminî olarak işaretli)` : ""}. İngilizce İSNAD'da bu kişilerin adları EI3'e göre yazılır, Türkçe kayıtlardaki adlar DİA yazımına göre denetlenir.`, "success");
}

export function wirePersons(): void {
  const input = $<HTMLInputElement>("persons-file");
  input.onchange = () =>
    void run("Tablo okunuyor", async () => {
      const f = input.files?.[0];
      input.value = "";
      if (f) await importTable(f);
    });
  $("persons-remove").onclick = () =>
    void run("Kaldırılıyor", async () => {
      await setMeta("persons", null);
      use(null);
      if (english()) await refresh(false, true);
      setMessage("Şahıslar tablosu kaldırıldı; adlar kayıtta yazıldığı gibi.", "info");
    });
  $("person-ei3").onclick = () =>
    void run("Adlar çevriliyor", async () => {
      if (!index) throw new Error("Önce Aktar → Şahıslar tablosu'nu yükleyin.");
      const text = await serial(() => word.selectionText());
      if (!text.trim()) throw new Error("Önce Word'de çevrilecek metni (ör. İngilizce özeti) seçin.");
      const pairs = ei3Replacements(text, index);
      if (!pairs.length) return setMessage("Seçili metinde tablodaki kişilerin DİA yazımıyla geçen adı bulunamadı.", "info");
      const n = await serial(() => word.replaceInSelection(pairs));
      setMessage(`${n} ad EI3 yazımına çevrildi: ${pairs.slice(0, 5).map((p) => `${p.from} → ${p.to}`).join("; ")}${pairs.length > 5 ? " …" : ""}.${pairs.some((p) => /[’'][\p{L}]+$/u.test(p.from) && !/[’'][sS]$/.test(p.from)) ? ' Türkçe ekler ("’nin") kaldırıldı; cümleyi gözden geçirin.' : ""}`, "success");
    });
}

// ---------------------------------------------------------------- DİA spelling in Turkish

/** Creators the table knows written otherwise than DİA writes them: an issue with the DİA form as its fix. */
export function personIssues(item: Item): Issue[] {
  if (!index) return [];
  const out: Issue[] = [];
  item.creators.forEach((c, i) => {
    const s = diaSuggestion(c, index!);
    if (!s) return;
    const name = s.creator.name ?? `${s.creator.firstName ? `${s.creator.firstName} ` : ""}${s.creator.lastName}`.replace(/- /, "-");
    const death = s.person.death ? ` (ö. ${s.person.death})` : "";
    out.push({
      key: item.key,
      code: s.loose ? "dia-name-loose" : "dia-name",
      level: "warning",
      creatorIndex: i,
      message: s.loose ? `Kişi adı DİA'da "${name}"${death} diye yazılıyor; aynı kişi mi, bakın.` : `Kişi adının DİA yazımı: ${name}${death}.`,
      fix: { creatorIndex: i, creator: s.creator },
      fixLabel: "DİA yazımını uygula",
    });
  });
  return out;
}

/** When a record is added: names that differ from DİA only in marks and case ("Gazzali" → "Gazzâlî") take DİA's form. */
export function diaSpelling(items: Item[]): string[] {
  if (!index) return [];
  const changed: string[] = [];
  items.forEach((it, k) => {
    let touched = false;
    const creators = it.creators.map((c) => {
      const s = diaSuggestion(c, index!);
      // Safe without asking: only marks differ, or the very name as typed is filed under its famous part ("Müslim").
      // (A famous name of several words, "Müslim b. Haccâc", is printed after the full name, as İSNAD does with
      // "… Ahmed b. Hanbel": the note changes, so that one is offered in Denetim instead.)
      const refiled = s && !s.loose && !(s.creator.lastName ?? "").includes(" ") && s.creator.firstName === `${c.firstName ?? ""}${/-$/.test(c.firstName ?? "") ? "" : " "}${c.lastName ?? ""}`.trim();
      if (!s || s.loose || (!onlyMarks(c, s.creator) && !refiled)) return c;
      touched = true;
      changed.push(s.creator.lastName ?? s.creator.name ?? "");
      return s.creator;
    });
    if (touched) items[k] = { ...it, creators };
  });
  return changed;
}

/** DİA surnames for the editor's surname box ("gazz" → Gazzâlî, Gazzî …). */
export function diaSurnames(q: string): string[] {
  if (!index || q.trim().length < 3) return [];
  return [...new Set(searchPersons(q, index, 10).filter((p) => /arap|fars/i.test(p.group)).map((p) => diaParts(p).surname))];
}
