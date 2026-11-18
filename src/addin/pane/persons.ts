/**
 * Şahıslar tablosu (DİA – EI3): imported once from the user's own .xlsx /
 * .csv, kept in this computer's storage. With it, English İSNAD writes the
 * names of these persons the EI3 way, and the Atıf pane writes a person's
 * name with the death date İSNAD asks for: "Gazzâlî (ö. 505/1111)".
 */
import { setEnglishNames } from "../../core/docstate.js";
import { type Person, type PersonIndex, type PersonTable, englishCreator, findPerson, indexPersons, personInText, searchPersons, tableFrom } from "../../core/persons.js";
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
