/**
 * Şahıslar tablosu (DİA – EI3): imported once from the user's own .xlsx /
 * .csv, kept in this computer's storage. With it, English İSNAD writes the
 * names of these persons the EI3 way, and the Atıf pane writes a person's
 * name with the death date İSNAD asks for: "Gazzâlî (ö. 505/1111)".
 */
import { setEnglishNames } from "../../core/docstate.js";
import { type DeathMention, type Person, type PersonIndex, type PersonTable, diaParts, missingDeathDates, diaSuggestion, englishCreator, findPerson, indexPersons, onlyMarks, personInText, searchPersons, tableFrom } from "../../core/persons.js";
import type { Issue } from "../../core/isnad.js";
import type { Item } from "../../core/zotero.js";
import * as word from "../word.js";
import { getMeta, setMeta } from "../store.js";
import { $, doc, h, run, serial, setMessage } from "./core.js";
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
  $<HTMLInputElement>("person-q").disabled = !t;
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
  setMessage(`Şahıslar tablosu yüklendi: ${table.persons.length.toLocaleString("tr-TR")} kişi${unsure ? ` (${unsure} kişinin EI3 yazımı tabloda tahminî olarak işaretli)` : ""}. İngilizce İSNAD'da bu kişilerin adları EI3'e göre yazılır; Atıf sekmesinden adı vefat tarihiyle ekleyebilirsiniz.`, "success");
}

function personRow(p: Person): HTMLElement {
  const en = english();
  const btn = h(
    "button",
    { type: "button", class: "person-hit" },
    h("span", { class: "r-title" }, personInText(p, en)),
    h("span", { class: "r-more" }, `${en ? p.dia : p.ei3}${p.unsure ? " · EI3 yazımı tahminî" : ""}`),
  );
  btn.onclick = () =>
    void run("Ekleniyor", async () => {
      await serial(() => word.insertPlainText(personInText(p, en)));
      setMessage(`Metne yazıldı: ${personInText(p, en)}. İSNAD vefat tarihini adın ilk geçtiği yerde ister.`, "success");
    });
  return btn;
}

function search(): void {
  const q = $<HTMLInputElement>("person-q").value;
  $("person-hits").replaceChildren(...(index && q.trim().length >= 2 ? searchPersons(q, index, 8).map((p) => h("li", {}, personRow(p))) : []));
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
  $<HTMLInputElement>("person-q").oninput = search;
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
      if (!s || s.loose || !onlyMarks(c, s.creator)) return c;
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

// ---------------------------------------------------------------- death dates at the first mention

/** Persons mentioned in the document's text without the death date at their first mention. */
export async function missingDates(): Promise<DeathMention[]> {
  if (!index) return [];
  const { text, own } = await serial(() => word.bodyText());
  // Read in the writer's own text; the place counted in the whole text, as Word's search sees it.
  return missingDeathDates(own, index, english()).map((d) => ({ ...d, n: occurrences(text.slice(0, d.at), d.word) }) as DeathMention & { n: number });
}

function occurrences(hay: string, needle: string): number {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Writes the dates after the first mentions (the last first, so the earlier places do not move). */
export async function addDates(list: readonly (DeathMention & { n?: number })[]): Promise<number> {
  let done = 0;
  for (const d of [...list].sort((a, b) => b.at - a.at)) if (await serial(() => word.insertAfterOccurrence(d.word, (d as { n?: number }).n ?? 0, ` ${d.note}`))) done++;
  return done;
}
