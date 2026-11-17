/**
 * Fotoğraftan / PDF'ten ekle: a photo of a title or künye page, a screenshot,
 * or a PDF (an article, a thesis, a scanned book) becomes a record.
 *
 * Everything runs in the pane: the text recognizer (Tesseract, Turkish and
 * English) and the PDF reader (pdf.js) are served with the add-in and load
 * only when first used; no image or file leaves the computer. Only the DOI or
 * ISBN found on the page is sent to the catalogues, as with "Bul ve ekle".
 */
import { cleanIsbn, lookupIsbn } from "../../core/importers.js";
import { completeFromPage, type PageLine, type PageReading, readPage } from "../../core/pagetext.js";
import { type Item, creatorLine, titleOf } from "../../core/zotero.js";
import { getMeta } from "../store.js";
import { $, putItems, run, setMessage } from "./core.js";
import { openEditor } from "./editor.js";
import { currentView } from "./library.js";
import { alreadyNote, isnadFix, lookupDoiOrIsbn, showAlready, splitExisting } from "./io.js";

const vendor = (path: string) => new URL(`vendor/${path}`, location.href).href;

function progress(text: string): void {
  $("busy-text").textContent = text;
}

// ---------------------------------------------------------------- OCR

interface TesseractWord {
  bbox: { y0: number; y1: number };
}
interface TesseractLine {
  text: string;
  bbox: { y0: number };
  words: TesseractWord[];
}
interface TesseractWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(image: HTMLCanvasElement, options: object, output: object): Promise<{ data: { text: string; blocks: { paragraphs: { lines: TesseractLine[] }[] }[] | null } }>;
}
declare global {
  interface Window {
    Tesseract?: { createWorker(langs: string[], oem: number, options: object): Promise<TesseractWorker> };
  }
}

let worker: Promise<TesseractWorker> | null = null;
let onProgress: ((p: number) => void) | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => ok();
    s.onerror = () => fail(new Error("Metin tanıma bileşeni yüklenemedi; internet bağlantısını denetleyin."));
    document.head.append(s);
  });
}

function getWorker(): Promise<TesseractWorker> {
  worker ??= (async () => {
    progress("Metin tanıma hazırlanıyor (ilk seferde ~10 MB iner)");
    if (!window.Tesseract) await loadScript(vendor("tesseract/tesseract.min.js"));
    const w = await window.Tesseract!.createWorker(["tur", "eng"], 1, {
      workerPath: vendor("tesseract/worker.min.js"),
      corePath: vendor("tesseract/"),
      langPath: vendor("tessdata"),
      gzip: true,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") onProgress?.(m.progress);
      },
    });
    // Automatic page layout: a title page is a few lines far apart (the single-block default drops some).
    await w.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1" });
    return w;
  })().catch((e: unknown) => {
    worker = null;
    throw e;
  });
  return worker;
}

/** A phone photo (4000 px) is read as fast and as well at ~2200 px; grey, so colour covers do not confuse it. */
async function toCanvas(image: Blob | HTMLCanvasElement): Promise<HTMLCanvasElement> {
  if (image instanceof HTMLCanvasElement) return image;
  const bmp = await createImageBitmap(image).catch(() => {
    throw new Error("Görüntü açılamadı (JPEG, PNG ya da WebP olmalı; iPhone'un HEIC fotoğraflarını önce JPEG olarak kaydedin).");
  });
  const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext("2d")!;
  g.filter = "grayscale(1) contrast(1.15)";
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

async function ocr(image: Blob | HTMLCanvasElement, label: string): Promise<PageLine[]> {
  const w = await getWorker();
  const canvas = await toCanvas(image);
  onProgress = (p) => progress(`${label} okunuyor %${Math.round(p * 100)}`);
  try {
    const { data } = await w.recognize(canvas, {}, { blocks: true, text: true });
    const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    return [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0).map((l) => ({ text: l.text.trim(), size: median(l.words.map((x) => x.bbox.y1 - x.bbox.y0)) })).filter((l) => l.text);
  } finally {
    onProgress = null;
  }
}

// ---------------------------------------------------------------- PDF

interface PdfTextItem {
  str: string;
  transform: number[];
  height: number;
}
interface PdfPage {
  getTextContent(): Promise<{ items: (PdfTextItem | object)[] }>;
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: object }): { promise: Promise<void> };
}
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(o: { data: Uint8Array; isEvalSupported?: boolean }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPage> }> };
}

let pdfjs: Promise<PdfJs> | null = null;

function getPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    progress("PDF okuyucu yükleniyor");
    const url = vendor("pdfjs/pdf.min.mjs");
    const lib = (await import(/* webpackIgnore: true */ url)) as PdfJs;
    lib.GlobalWorkerOptions.workerSrc = vendor("pdfjs/pdf.worker.min.mjs");
    return lib;
  })().catch((e: unknown) => {
    pdfjs = null;
    throw e;
  });
  return pdfjs;
}

/** A PDF page's text as lines, top to bottom, with each line's letter size. */
function pdfLines(items: (PdfTextItem | object)[]): PageLine[] {
  const rows: { y: number; x: number; size: number; text: string }[] = [];
  for (const it of items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [, , , d = 0, x = 0, y = 0] = it.transform;
    const size = Math.abs(d) || it.height;
    const row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, size * 0.4));
    if (row) {
      row.text += (x > row.x && !/\s$/.test(row.text) && !/^\s/.test(it.str) ? " " : "") + it.str;
      row.size = Math.max(row.size, size);
      row.x = x;
    } else rows.push({ y, x, size, text: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => ({ text: r.text.replace(/\s+/g, " ").trim(), size: r.size }));
}

/** The first pages of a PDF; a scan (no text in it) is read by OCR. */
async function readPdf(file: Blob, name: string): Promise<PageLine[][]> {
  const lib = await getPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const pages: PageLine[][] = [];
  const n = Math.min(pdf.numPages, 4);
  for (let i = 1; i <= n; i++) {
    progress(`${name}: ${i}. sayfa`);
    const page = await pdf.getPage(i);
    let lines = pdfLines((await page.getTextContent()).items);
    if (lines.map((l) => l.text).join("").replace(/\s/g, "").length < 40) {
      // A scanned page: render it and read it.
      const vp = page.getViewport({ scale: 2 });
      const c = document.createElement("canvas");
      c.width = vp.width;
      c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
      lines = await ocr(await toCanvas(c), `${name}: ${i}. sayfa`);
    }
    if (lines.length) pages.push(lines);
    // An article or a thesis says everything on its first page or two.
    if (i >= 2 && pages.some((p) => readPage(p).dois.length)) break;
  }
  return pages;
}

// ---------------------------------------------------------------- the record

function richness(r: PageReading): number {
  if (!r.item) return -1;
  return (r.how === "atif" ? 20 : 0) + Object.keys(r.item.fields).length + r.item.creators.length - r.unsure.length;
}

/** What the pages say, best page first; the catalogue's record for a DOI or ISBN on them, completed from the page. */
async function recordFrom(pages: PageLine[][]): Promise<{ item: Item | null; unsure: string[]; via: string; text: string; failed: string }> {
  const readings = pages.map(readPage);
  const text = pages.map((p) => p.map((l) => l.text).join("\n")).join("\n\n");
  const dois = [...new Set(readings.flatMap((r) => r.dois))];
  const isbns = [...new Set(readings.flatMap((r) => r.isbns))];
  const ranked = [...readings].sort((a, b) => richness(b) - richness(a));
  let page: Item | null = ranked[0]?.item ?? null;
  for (const r of ranked.slice(1)) if (page && r.item) page = completeFromPage(page, r.item);
  const unsure = ranked[0]?.unsure ?? [];
  let failed = "";
  const googleKey = (await getMeta<string>("googleBooksKey").catch(() => undefined)) || undefined;
  // An article prints its own DOI and the DOIs it cites: the first one on the first page is its own.
  if (dois[0] && !(isbns.length && page?.itemType === "book")) {
    progress("DOI ile aranıyor");
    try {
      return { item: completeFromPage(await lookupDoiOrIsbn(dois[0]), page), unsure: [], via: `DOI ${dois[0]}`, text, failed };
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
  }
  for (const isbn of isbns.slice(0, 2)) {
    progress("ISBN ile aranıyor");
    try {
      const found = await lookupIsbn(cleanIsbn(isbn) ?? isbn, fetch, googleKey);
      return { item: completeFromPage(found, page), unsure: [], via: `ISBN ${isbn}`, text, failed };
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    }
  }
  return { item: page, unsure, via: ranked[0]?.how === "atif" ? "sayfadaki atıf satırı" : "sayfanın düzeni", text, failed };
}

async function addFromPages(pages: PageLine[][], what: string): Promise<void> {
  if (!pages.some((p) => p.length)) throw new Error(`${what} metin bulunamadı. Fotoğraf net ve düz mü? Sayfayı ışığa tutup, yazıyı kadraja doldurarak yeniden çekin.`);
  const r = await recordFrom(pages);
  if (!r.item) {
    // Nothing sensible: give the text to the paste box, to be put in order by hand.
    $<HTMLTextAreaElement>("new-paste").value = r.text;
    throw new Error(`${what} künye çıkarılamadı. Okunan metni "Künye yapıştır" kutusuna koydum; künye satırını düzenleyip Ekle'ye basın.`);
  }
  const v = currentView();
  const items = [{ ...r.item, source: "sayfa", collections: v.kind === "collection" ? [v.key] : r.item.collections }];
  const fixedNote = isnadFix(items);
  const { fresh, already } = splitExisting(items);
  if (!fresh.length) return showAlready(already);
  await putItems(fresh);
  const it = fresh[0]!;
  openEditor(it.key);
  const look = r.unsure.length ? ` Okunamayan ya da emin olunmayan: ${r.unsure.join(", ")}.` : "";
  const failNote = r.failed && !r.via.startsWith("DOI") && !r.via.startsWith("ISBN") ? ` (Sayfadaki numara kataloglarda bulunamadı: ${r.failed})` : "";
  setMessage(`Eklendi (${r.via}): ${creatorLine(it) || "—"}, ${titleOf(it)}.${fixedNote}${alreadyNote(already)}${look}${failNote} Fotoğraftan okunan harfleri (â, î, ü …) önizlemede gözden geçirin.`, r.unsure.length || r.via.startsWith("sayfa") ? "warning" : "success");
}

/** Photos, screenshots, PDFs: each PDF is one work; the photos together are one work (cover + künye page). */
export async function scanFiles(files: readonly File[]): Promise<void> {
  if (!files.length) return;
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
  const images = files.filter((f) => !pdfs.includes(f));
  for (const f of pdfs) await addFromPages(await readPdf(f, f.name), `${f.name} içinde`);
  if (images.length) {
    const pages: PageLine[][] = [];
    for (const [i, f] of images.entries()) pages.push(await ocr(f, images.length > 1 ? `${i + 1}. fotoğraf` : "Fotoğraf"));
    await addFromPages(pages, images.length > 1 ? "Fotoğraflarda" : "Fotoğrafta");
  }
}

export function wireScan(): void {
  const input = $<HTMLInputElement>("new-scan");
  input.onchange = () =>
    void run("Okunuyor", async () => {
      await scanFiles([...(input.files ?? [])]);
      input.value = "";
    });
  const zone = $("scan-zone");
  // Editable only so that it takes Ctrl+V; nothing typed stays in it.
  zone.addEventListener("beforeinput", (e) => e.preventDefault());
  const take = (files: File[]) => void run("Okunuyor", () => scanFiles(files));
  zone.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => Boolean(f));
    if (!files.length) {
      setMessage("Panoda görüntü yok. Künyenin ekran görüntüsünü alın (Windows: Win+Shift+S, Mac: Cmd+Ctrl+Shift+4), sonra buraya tıklayıp Ctrl+V.", "info");
      return;
    }
    e.preventDefault();
    take(files);
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("drag");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag");
    take([...(e.dataTransfer?.files ?? [])]);
  });
}
