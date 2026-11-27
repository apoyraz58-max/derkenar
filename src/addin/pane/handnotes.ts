/**
 * Belge → Elle yazılmış dipnotlar: footnotes typed by hand become Künye
 * citations in place (the note, its number and its place stay). First a
 * look at what would change; then the change, which Word's Undo takes back.
 */
import { type HandInText, type HandNote, SHORT_UNKNOWN, unkeptWords, bibliographyLines, sectionHeadings, checkBibliography, checkInTextBibliography, inTextAuthorYears, readHandNotes, readInText } from "../../core/handnotes.js";
import { newCitationId, putCitation } from "../../core/docstate.js";
import type { CiteRef } from "../../core/types.js";
import { type Item, creatorLine, titleOf } from "../../core/zotero.js";
import * as word from "../word.js";
import { $, S, copyText, doc, getRenderer, h, putItems, run, serial, setMessage } from "./core.js";
import { refresh } from "./document.js";
import { isnadFix } from "./io.js";
import { copyFinder } from "../../core/library.js";
import { parseReference } from "../../core/freetext.js";

let plan: HandNote[] = [];

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

function describe(n: HandNote): string {
  return n.refs!.map((r) => `${r.prefix ? `${r.prefix} ` : ""}${creatorLine(r.item) || "—"}, ${short(titleOf(r.item), 50)}${r.madde ? `, “${r.madde}”` : ""}${r.kitab ? `, “${r.kitab}”${r.bab ? `, ${r.bab}` : ""}${r.hadisNo ? ` (no. ${r.hadisNo})` : ""}` : ""}${r.sure ? `, ${r.sure}/${r.ayet}` : ""}${r.volume ? `, c. ${r.volume}` : ""}${r.locator ? `, ${r.label === "sub verbo" ? "md." : "s."} ${r.locator}` : ""}${r.isNew ? " (yeni)" : ""}${r.unsure?.length ? ` — ${r.unsure.join(", ")}: kütüphanede ekleyin` : ""}`).join("; ");
}

async function scan(): Promise<void> {
  if (!word.footnotesSupported()) throw new Error("Bu Word sürümü dipnotları okumaya izin vermiyor (WordApi 1.5 gerekir).");
  const notes = await serial(() => word.handNotes());
  if (!notes.length) {
    $("hand-result").replaceChildren(h("p", { class: "muted small" }, "Elle yazılmış dipnot yok; bütün dipnotlar zaten Künye atıfı ya da belge dipnotsuz."));
    return;
  }
  // The notes are read in order, so "a.g.e." and short forms find the work cited before them.
  const read = readHandNotes(notes.map((n) => n.text), S.items);
  plan = read.map((r, i) => ({ ...r, index: notes[i]!.index }));
  const ok = plan.filter((p) => p.refs);
  const kept = plan.filter((p) => !p.refs && p.text);
  const fresh = new Set(ok.flatMap((p) => p.refs!.filter((r) => r.isNew).map((r) => r.item)));
  $("hand-result").replaceChildren(
    h("p", { class: "small" }, `${notes.length} dipnottan ${ok.length} tanesi atıfa çevrilebilir${fresh.size ? `; ${fresh.size} eser kütüphanede yok, eklenecek` : ""}. ${kept.length ? `${kept.length} dipnot (açıklama ya da okunamayan) olduğu gibi kalır.` : ""}`),
    h(
      "ol",
      { class: "hand-list small" },
      ...plan.filter((p) => p.text).slice(0, 200).map((p) =>
        h("li", { value: String(p.index + 1), class: p.refs ? "" : "muted" }, h("div", { class: "hand-src" }, short(p.text, 140)), h("div", { class: p.refs ? "hand-to" : "hand-keep" }, p.refs ? `→ ${describe(p)}` : `kalır: ${p.reason}`)),
      ),
    ),
    ...(plan.filter((p) => p.text).length > 200 ? [h("p", { class: "muted small" }, `Listede ilk 200 dipnot gösteriliyor; çeviri ${ok.length} dipnotun hepsine uygulanır. Önce bir kopya belgede deneyin.`)] : []),
    ...(plan.filter((p) => p.reason === SHORT_UNKNOWN).length
      ? [h("p", { class: "notice small" }, `${plan.filter((p) => p.reason === SHORT_UNKNOWN).length} dipnot kısa künyeyle anılan ama tam künyesi dipnotlarda olmayan eserlere gidiyor (ör. "Buhârî, “Îmân”, 2"). Önce aşağıda kaynakçayı seçip "Seçili kaynakçayı oku"ya basın; eserler kütüphaneye girince yeniden tarayın, bu dipnotlar da bağlanır.`)]
      : []),
    ok.length ? h("button", { type: "button", class: "primary", onclick: () => void run("Dipnotlar çevriliyor", convert) }, `${ok.length} dipnotu atıfa çevir`) : h("p", { class: "muted small" }, "Çevrilecek dipnot yok."),
  );
}

async function convert(): Promise<void> {
  const ok = plan.filter((p) => p.refs);
  if (!ok.length) return;
  const d = doc();
  // New works: İSNAD fixes as for any added record, then into the library.
  const fresh = [...new Set(ok.flatMap((p) => p.refs!.filter((r) => r.isNew).map((r) => r.item)))];
  const fixed = [...fresh];
  const fixedNote = isnadFix(fixed);
  const byKey = new Map<string, Item>(fixed.map((i) => [i.key, i]));
  if (fixed.length) await putItems(fixed);
  const writes: { index: number; id: string; segments: { text: string }[] }[] = [];
  for (const p of ok) {
    const refs: CiteRef[] = p.refs!.map((r) => ({ id: r.item.key, ...(r.volume ? { volume: r.volume } : {}), ...(r.locator ? { locator: r.locator } : {}), ...(r.label ? { label: r.label } : {}), ...(r.kitap ? { kitap: r.kitap, bab: r.bab, cumle: r.cumle } : {}), ...(r.kitab ? { kitab: r.kitab, ...(r.bab ? { bab: r.bab } : {}), ...(r.hadisNo ? { hadisNo: r.hadisNo } : {}) } : {}), ...(r.sure ? { sure: r.sure, ayet: r.ayet } : {}), ...(r.madde ? { madde: r.madde } : {}), ...(r.prefix ? { prefix: r.prefix } : {}) }));
    const works = Object.fromEntries(refs.map((r) => [r.id, byKey.get(r.id) ?? S.byKey.get(r.id) ?? d.items[r.id]!]));
    const id = newCitationId();
    putCitation(d, id, refs, works);
    writes.push({ index: p.index, id, segments: [{ text: p.text }] });
  }
  const done = await serial(() => word.replaceNotes(writes));
  await word.saveState(d);
  // İSNAD's first full, then short references (never a.g.e.) are written by the refresh.
  await refresh(false, true);
  plan = [];
  $("hand-result").replaceChildren();
  const others = ok.flatMap((p) => p.refs!.filter((r) => r.unsure?.length)).length;
  setMessage(`${done} dipnot Künye atıfına çevrildi; ilk geçişler tam, sonrakiler kısa künye oldu (İSNAD gereği a.g.e. kullanılmaz).${fresh.length ? ` ${fresh.length} eser kütüphaneye eklendi.` : ""}${fixedNote} ${others ? ` ${others} eser "vd." ile anılmıştı: diğer yazarlarını kütüphanede ekleyin, yoksa atıfta "vd." çıkmaz.` : ""} Eski elle yazılmış kaynakçayı silip Kaynakça ekle ile Künye'ninkini koyabilirsiniz.`, others ? "warning" : "success");
}

// ---------------------------------------------------------------- a bibliography typed by hand

interface BibLine {
  text: string;
  item: Item | null;
  isNew: boolean;
  /** Words of the line the record would not keep: the work is taken, the typed list stays in place. */
  lost?: string[];
}
let bib: { text: string; lines: BibLine[] } | null = null;

function readBibliography(text: string): BibLine[] {
  const created: Item[] = [];
  const copies = copyFinder(S.items);
  return bibliographyLines(text)
    .map((l) => {
      const r = parseReference(l);
      if (!r || (!r.item.fields.title && !r.item.fields.docketNumber)) return { text: l, item: null, isNew: false };
      const lostIn = (it: Item) => unkeptWords(l, [{ item: it, isNew: false, form: "full" }]);
      const old = copies.find(r.item);
      if (old) {
        const lost = lostIn(old).filter((w) => lostIn(r.item).includes(w));
        return { text: l, item: old, isNew: created.includes(old), ...(lost.length ? { lost } : {}) };
      }
      const item = { ...r.item, source: "kaynakca" };
      created.push(item);
      copies.add(item);
      const lost = lostIn(item);
      return { text: l, item, isNew: true, ...(lost.length ? { lost } : {}) };
    });
}

async function scanBibliography(): Promise<void> {
  const text = (await serial(() => word.selectionText())).trim();
  if (text.length < 20) throw new Error("Önce Word'de elle yazılmış kaynakçanın tamamını seçin (başlığıyla ya da başlıksız), sonra yeniden basın.");
  const lines = readBibliography(text);
  bib = { text, lines };
  const read = lines.filter((l) => l.item);
  // A line whose words the record would not all keep counts as not read for replacing the typed list.
  const unread = lines.filter((l) => !l.item || l.lost);
  const fresh = read.filter((l) => l.isNew).length;
  $("hand-bib-result").replaceChildren(
    h("p", { class: "small" }, `${lines.length} künyeden ${read.length} tanesi okundu${fresh ? ` (${fresh} eser kütüphanede yok, eklenecek)` : ""}.${unread.length ? ` ${unread.length} satır okunamadı ya da kaydına tam sığmıyor; seçili metin bu yüzden yerinde bırakılacak, okunan eserler yine de kütüphaneye ve kaynakçaya girer.` : " Seçili metnin yerine Künye kaynakçası gelecek."}`),
    h(
      "ol",
      { class: "hand-list small" },
      ...lines.slice(0, 300).map((l) => h("li", { class: l.item ? "" : "muted" }, h("div", { class: "hand-src" }, short(l.text, 140)), h("div", { class: l.item ? "hand-to" : "hand-keep" }, l.item ? `→ ${creatorLine(l.item) || "—"}, ${short(titleOf(l.item), 60)}${l.isNew ? " (yeni)" : ""}${l.lost ? ` — kayıtta yeri olmayan: ${l.lost.slice(0, 4).join(", ")}` : ""}` : "okunamadı"))),
    ),
    ...(lines.length > 300 ? [h("p", { class: "muted small" }, `Listede ilk 300 künye gösteriliyor; ${read.length} künyenin hepsi alınır.`)] : []),
    read.length ? h("button", { type: "button", class: "primary", onclick: () => void run("Kaynakça çevriliyor", convertBibliography) }, unread.length ? `${read.length} eseri kütüphaneye ve kaynakçaya al` : "Künye kaynakçasına çevir") : h("p", { class: "muted small" }, "Okunan künye yok."),
  );
}

async function convertBibliography(): Promise<void> {
  if (!bib) return;
  const now = (await serial(() => word.selectionText())).trim();
  if (now !== bib.text) {
    bib = null;
    $("hand-bib-result").replaceChildren();
    throw new Error("Seçim değişti. Kaynakçayı yeniden seçip Seçili kaynakçayı oku'ya basın.");
  }
  const d = doc();
  const read = bib.lines.filter((l) => l.item);
  const fresh = [...new Set(read.filter((l) => l.isNew).map((l) => l.item!))];
  const fixedNote = isnadFix(fresh);
  if (fresh.length) await putItems(fresh);
  const fixed = new Map(fresh.map((i) => [i.key, i]));
  // Works listed though not cited stay in the bibliography.
  const cited = new Set(Object.values(d.citations).flatMap((c) => c.items.map((r) => r.id)));
  const uncited = new Set(d.bibUncited ?? []);
  for (const l of read) {
    const it = fixed.get(l.item!.key) ?? S.byKey.get(l.item!.key) ?? l.item!;
    if (!cited.has(it.key)) {
      uncited.add(it.key);
      d.items[it.key] = it;
    }
  }
  d.bibUncited = [...uncited];
  // The typed bibliography was divided ("Kitaplar", "Makaleler" …): so is Künye's.
  const sectioned = !d.bibSections && sectionHeadings(bib.text).length >= 2;
  if (sectioned) {
    d.bibSections = true;
    $<HTMLInputElement>("bib-sections").checked = true;
  }
  const unread = bib.lines.filter((l) => !l.item || l.lost).length;
  const replaced = unread ? false : await serial(() => word.selectionToBibliography());
  await word.saveState(d);
  await refresh(false, true);
  bib = null;
  $("hand-bib-result").replaceChildren();
  setMessage(
    `${read.length} eser kaynakçaya alındı${fresh.length ? `, ${fresh.length} tanesi kütüphaneye eklendi` : ""}.${fixedNote}${sectioned ? " Elle yazılmış kaynakça ara başlıklarla bölünmüştü; Künye'ninki de türlere ayrıldı (Belge → Kaynakçayı türlere ayır)." : ""} ${replaced ? "Elle yazılmış kaynakçanın yerinde artık Künye kaynakçası var." : unread ? `Okunamayan ya da kaydına tam sığmayan ${unread} satır yüzünden elle yazılmış kaynakça yerinde bırakıldı; Kaynakça ekle ile Künye'ninkini koyup eskisini, o satırları karşılaştırarak silin.` : "Belgede zaten bir Künye kaynakçası var; elle yazılmış olanı silebilirsiniz."}`,
    unread ? "warning" : "success",
  );
}

// ---------------------------------------------------------------- in-text citations typed by hand

let inText: { found: HandInText[]; counts: Record<string, number> } | null = null;

async function scanInText(): Promise<void> {
  const r = await getRenderer();
  if (r.meta.note) throw new Error("Belgenin stili dipnotlu. Metin içi atıfları çevirmek için önce Belge → Atıf stili'ni metin içi bir stile (İSNAD metin içi, APA …) çevirin.");
  const text = await serial(() => word.documentText());
  const found = readInText(text, S.items);
  if (!found.length) {
    $("hand-intext-result").replaceChildren(h("p", { class: "muted small" }, "Kütüphanedeki bir eserle eşleşen elle yazılmış metin içi atıf bulunamadı. Eserler kütüphanede değilse önce kaynakçayı okutun (yukarıda)."));
    return;
  }
  const counts = await serial(() => word.countInBody(found.map((f) => f.match)));
  const usable = found.filter((f) => counts[f.match]);
  inText = { found: usable, counts };
  const total = usable.reduce((n, f) => n + counts[f.match]!, 0);
  $("hand-intext-result").replaceChildren(
    h("p", { class: "small" }, `${total} metin içi atıf kütüphanedeki eserlerle eşleşti.`),
    h("ol", { class: "hand-list small" }, ...usable.slice(0, 200).map((f) => h("li", {}, h("div", { class: "hand-src" }, `${f.match}${counts[f.match]! > 1 ? ` (${counts[f.match]} yerde)` : ""}`), h("div", { class: "hand-to" }, `→ ${f.refs.map((x) => `${x.prefix ? `${x.prefix} ` : ""}${creatorLine(x.item) || "—"}, ${short(titleOf(x.item), 50)}${x.locator ? `, s. ${x.locator}` : ""}`).join("; ")}`)))),
    ...(usable.length > 200 ? [h("p", { class: "muted small" }, `Listede ilk 200 atıf gösteriliyor; çeviri hepsine uygulanır.`)] : []),
    total ? h("button", { type: "button", class: "primary", onclick: () => void run("Atıflar çevriliyor", convertInText) }, `${total} atıfı çevir`) : h("p", { class: "muted small" }, "Çevrilecek atıf yok."),
  );
}

async function convertInText(): Promise<void> {
  if (!inText) return;
  const d = doc();
  const writes = inText.found.map((f) => {
    const refs: CiteRef[] = f.refs.map((r) => ({ id: r.item.key, ...(r.volume ? { volume: r.volume } : {}), ...(r.locator ? { locator: r.locator } : {}), ...(r.prefix ? { prefix: r.prefix } : {}) }));
    const works = Object.fromEntries(refs.map((r) => [r.id, S.byKey.get(r.id) ?? d.items[r.id]!]));
    const ids = Array.from({ length: inText!.counts[f.match]! }, () => {
      const id = newCitationId();
      putCitation(d, id, refs, works);
      return id;
    });
    return { text: f.match, ids, segments: [{ text: f.match }] };
  });
  const done = await serial(() => word.replaceInBody(writes));
  // Citations Word did not find again (the text changed meanwhile) are dropped from the state.
  await word.saveState(d);
  await refresh(false, true);
  inText = null;
  $("hand-intext-result").replaceChildren();
  setMessage(`${done} metin içi atıf Künye atıfına çevrildi.`, "success");
}

// ---------------------------------------------------------------- footnotes against the bibliography

/** Dipnot – kaynakça uyumu: cited but not listed, listed but not cited. Nothing in the document changes. */
async function checkAgainstBibliography(): Promise<void> {
  const text = (await serial(() => word.selectionText())).trim();
  if (text.length < 20) throw new Error("Önce Word'de kaynakçanın tamamını seçin, sonra yeniden basın.");
  const notes = await serial(() => word.handNotes());
  const d = doc();
  // Works already cited with Künye count as cited too.
  const derkenar = [...new Set(Object.values(d.citations).flatMap((c) => c.items.map((r) => r.id)))].map((k) => d.items[k] ?? S.byKey.get(k)).filter((x): x is Item => Boolean(x));
  const lines = bibliographyLines(text);
  // In-text citations typed in the text ("(Kara, 2005: 45)", "Kara (2005)"): checked by author and year.
  const body = await serial(() => word.bodyText()).catch(() => "");
  if (inTextAuthorYears(body).length >= Math.max(3, notes.length)) {
    const t = checkInTextBibliography(body, lines);
    $("hand-check-result").replaceChildren(
      h("p", { class: "small" }, `Metinde ${t.citedCount} yazar-yıl atfı, kaynakçada ${t.listedCount} künye okundu.${!t.missing.length && !t.uncited.length ? " Uyumlu." : ""}`),
      ...(t.missing.length ? [h("p", { class: "small" }, h("strong", {}, `Metinde anılıp kaynakçada bulunmayan (${t.missing.length}):`)), h("ul", { class: "hand-list small" }, ...t.missing.slice(0, 100).map((m) => h("li", {}, `(${m})`)))] : []),
      ...(t.uncited.length ? [h("p", { class: "small" }, h("strong", {}, `Kaynakçada olup metinde anılmayan (${t.uncited.length}):`)), h("ul", { class: "hand-list small" }, ...t.uncited.slice(0, 100).map((l) => h("li", {}, short(l, 140))))] : []),
      ...(t.unreadLines.length ? [h("p", { class: "muted small" }, `Kaynakçada künye olarak okunamayan ${t.unreadLines.length} satır sayılmadı.`)] : []),
      h("p", { class: "muted small" }, "Metin içi atıflar ilk yazarın soyadı ve yılla karşılaştırıldı. Belgede hiçbir şey değişmez."),
    );
    report(
      [
        `Metin içi atıflar ile kaynakça (Künye): ${t.citedCount} yazar-yıl atfı, ${t.listedCount} künye.`,
        section("Metinde anılıp kaynakçada bulunmayan", t.missing.map((m) => `(${m})`)),
        section("Kaynakçada olup metinde anılmayan", t.uncited),
      ].join("\n"),
    );
    return;
  }
  const r = checkBibliography(notes.map((n) => n.text), lines, S.items, derkenar);
  const noteNo = (i: number) => (notes[i - 1] ? notes[i - 1]!.index + 1 : i);
  $("hand-check-result").replaceChildren(
    h("p", { class: "small" }, `Dipnotlarda ${r.citedCount} eser, kaynakçada ${r.listedCount} künye okundu.${!r.missing.length && !r.uncited.length ? " Kaynakça uyumlu: her anılan eser kaynakçada, kaynakçadaki her eser anılmış." : ""}`),
    ...(r.missing.length
      ? [h("p", { class: "small" }, h("strong", {}, `Dipnotta anılıp kaynakçada olmayan (${r.missing.length}):`)), h("ul", { class: "hand-list small" }, ...r.missing.slice(0, 100).map((m) => h("li", {}, `${creatorLine(m.item) || "—"}, ${short(titleOf(m.item), 70)}${m.notes.length ? ` — dn. ${m.notes.map(noteNo).slice(0, 6).join(", ")}${m.notes.length > 6 ? " …" : ""}` : ""}`)))]
      : []),
    ...(r.uncited.length ? [h("p", { class: "small" }, h("strong", {}, `Kaynakçada olup hiçbir dipnotta anılmayan (${r.uncited.length}):`)), h("ul", { class: "hand-list small" }, ...r.uncited.slice(0, 100).map((l) => h("li", {}, short(l, 140))))] : []),
    ...(r.unreadLines.length ? [h("p", { class: "muted small" }, `Kaynakçada künye olarak okunamayan ${r.unreadLines.length} satır sayılmadı.`)] : []),
    ...(r.shortFirst.length ? [h("p", { class: "small" }, h("strong", {}, `İlk geçişi kısa künye ya da a.g.e. ile yapılan (${r.shortFirst.length}):`), " İSNAD ilk atıfta tam künye ister."), h("ul", { class: "hand-list small" }, ...r.shortFirst.slice(0, 100).map((x) => h("li", {}, `dn. ${noteNo(x.note)}: ${creatorLine(x.item) || "—"}, ${short(titleOf(x.item), 70)}`)))] : []),
    ...(r.fullAgain.length ? [h("p", { class: "small" }, h("strong", {}, `İlk atıftan sonra yeniden tam künyeyle verilen (${r.fullAgain.length}):`), " İSNAD sonraki atıflarda kısa künye yazar."), h("ul", { class: "hand-list small" }, ...r.fullAgain.slice(0, 100).map((x) => h("li", {}, `${creatorLine(x.item) || "—"}, ${short(titleOf(x.item), 60)} — dn. ${x.notes.map(noteNo).slice(0, 6).join(", ")}${x.notes.length > 6 ? " …" : ""}`)))] : []),
    ...(r.shortVariants.length ? [h("p", { class: "small" }, h("strong", {}, `Kısa künyesi farklı yazılan (${r.shortVariants.length}):`), " Bir eser her yerde aynı kısa başlıkla anılır."), h("ul", { class: "hand-list small" }, ...r.shortVariants.slice(0, 100).map((x) => h("li", {}, x.forms.slice(0, 4).join(" · "))))] : []),
    ...(r.age.length ? [h("p", { class: "small" }, h("strong", {}, `a.g.e. / a.e. / Ibid. kullanılan dipnotlar (${r.age.length}):`), ` dn. ${r.age.map(noteNo).slice(0, 15).join(", ")}${r.age.length > 15 ? " …" : ""}. İSNAD bunların yerine kısa künye ister; "Dipnotları tara" ile Künye atıfına çevrilince kendiliğinden düzelir.`)] : []),
    h("p", { class: "muted small" }, "Yalnız okunabilen dipnotlar sayılır; açıklama dipnotları ve okunamayan künyeler dışarıda kalır. Kaynakçada yararlanılan ama anılmayan eserler bulunabilir; bu bir hata olmayabilir."),
  );
  const name = (it: Item) => `${creatorLine(it) || "—"}, ${titleOf(it)}`;
  report(
    [
      `Dipnotlar ile kaynakça (Künye): dipnotlarda ${r.citedCount} eser, kaynakçada ${r.listedCount} künye.`,
      section("Dipnotta anılıp kaynakçada olmayan", r.missing.map((m) => `${name(m.item)}${m.notes.length ? ` — dn. ${m.notes.map(noteNo).join(", ")}` : ""}`)),
      section("Kaynakçada olup hiçbir dipnotta anılmayan", r.uncited),
      section("İlk geçişi kısa künye ya da a.g.e. ile yapılan", r.shortFirst.map((x) => `dn. ${noteNo(x.note)}: ${name(x.item)}`)),
      section("İlk atıftan sonra yeniden tam künyeyle verilen", r.fullAgain.map((x) => `${name(x.item)} — dn. ${x.notes.map(noteNo).join(", ")}`)),
      section("Kısa künyesi farklı yazılan", r.shortVariants.map((x) => x.forms.join(" · "))),
      section("a.g.e. / a.e. / Ibid. kullanılan dipnotlar", r.age.length ? [`dn. ${r.age.map(noteNo).join(", ")}`] : []),
    ].join("\n"),
  );
}

/** A heading and its lines, for the report copied to the clipboard; nothing when the list is empty. */
function section(title: string, lines: readonly string[]): string {
  return lines.length ? `\n${title} (${lines.length}):\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
}

/** The whole result (lists not cut short), ready to copy and send. */
function report(text: string): void {
  $("hand-check-result").append(
    h("button", {
      type: "button",
      class: "link",
      onclick: () =>
        void run("Kopyalanıyor", async () => {
          await copyText(text.replace(/\n{3,}/g, "\n\n").trim());
          setMessage("Uyum denetiminin sonucu panoya kopyalandı (listelerin tamamı).", "success");
        }),
    }, "Sonucu panoya kopyala"),
  );
}

export function wireHandNotes(): void {
  $("hand-check").onclick = () => void run("Dipnotlar ve kaynakça karşılaştırılıyor", checkAgainstBibliography);
  $("hand-intext-scan").onclick = () => void run("Metin okunuyor", scanInText);
  $("hand-bib-scan").onclick = () => void run("Kaynakça okunuyor", scanBibliography);
  $("hand-scan").onclick = () => void run("Dipnotlar okunuyor", scan);
}
