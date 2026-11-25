import { createServer } from "node:http";
import type { Catalog } from "./store.js";

const page = `<!doctype html>
<html lang="tr">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Derkenar | Bibliyografik katalog</title>
<style>
:root { color-scheme:light; --ink:#27271e; --muted:#645f51; --border:#dfdbce; --paper:#f7f4eb; --card:#fffcf4; --accent:#286052 }
*{box-sizing:border-box} body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
header{background:#202d26;color:#fff9e8;padding:2rem max(5vw,1rem)} header p{margin:0;color:#dae5da} h1,h2{font-family:Georgia,serif;line-height:1.2} h1{font-size:clamp(2rem,5vw,3.1rem);margin:.25rem 0}
main{max-width:1250px;margin:auto;padding:1.3rem max(2vw,1rem) 3rem} h2{font-size:1.5rem;margin:0 0 1rem}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.65rem;margin:0 0 1rem}
.metrics div,section{border:1px solid var(--border);border-radius:10px;background:var(--card);padding:1rem}
.metrics span{display:block;color:var(--muted)} .metrics strong{font-size:1.85rem;color:var(--accent);font-variant-numeric:tabular-nums}
.columns{display:grid;grid-template-columns:1fr 1fr;gap:1rem} section{margin-bottom:1rem;min-width:0} .scroll{overflow:auto}
table{width:100%;border-collapse:collapse;text-align:left;white-space:normal;font-size:.91rem} th,td{padding:.6rem .65rem;border-bottom:1px solid var(--border);vertical-align:top} th{color:var(--muted);font-weight:650} tr:last-child td{border:0}
button{font:inherit;border:1px solid var(--accent);color:var(--accent);background:none;border-radius:6px;padding:.3rem .65rem;cursor:pointer} button:disabled{opacity:.5;cursor:default} a{color:var(--accent)}
.note{color:var(--muted);font-size:.9rem;margin:.2rem 0 1rem} #evidence td{max-width:25rem;overflow-wrap:anywhere} #error{color:#8c2824}
@media(max-width:700px){.columns{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}}
</style>
<header><p>Derkenar</p><h1>Bibliyografik katalog</h1></header>
<main>
  <p role="alert" id="error"></p>
  <div class="metrics" id="metrics" aria-label="Katalog sayımları"></div>
  <section><h2>Veri kaynakları</h2><div id="sources" class="scroll"></div></section>
  <div class="columns">
    <section><h2>Alan eksiklikleri</h2><p class="note">Oran, alandaki eksik baskı sayısının katalogdaki baskı sayısına bölümüdür.</p><div id="missing" class="scroll"></div></section>
    <section><h2>Doğrulama sonuçları</h2><div id="validation" class="scroll"></div></section>
  </div>
  <section><h2>Toplama işlemleri</h2><div id="jobs" class="scroll"></div></section>
  <section><h2>İnceleme kuyruğu</h2><div id="review" class="scroll"></div><button type="button" id="review-next">Sonraki kayıtlar</button></section>
  <section><h2>Baskı kayıtları</h2><div id="editions" class="scroll"></div><button type="button" id="edition-next">Sonraki baskılar</button></section>
  <section hidden id="detail"><h2 id="detail-title"></h2><div id="evidence" class="scroll"></div><h3>Baskı doğrulaması</h3><div id="edition-validation" class="scroll"></div></section>
</main>
<script src="/panel.js" defer></script>
</html>`;

const script = `
const element = id => document.getElementById(id);
const make = (tag, text) => {
  const node = document.createElement(tag);
  node.textContent = text ?? "";
  return node;
};
const num = new Intl.NumberFormat("tr-TR");
const percent = new Intl.NumberFormat("tr-TR", {style:"percent",maximumFractionDigits:1});
const dateTime = new Intl.DateTimeFormat("tr-TR", {dateStyle:"short",timeStyle:"short",timeZone:"Europe/Istanbul"});
const link = (url, text) => {
  if (!/^https:\\/\\//i.test(url)) return text;
  const node = make("a", text);
  node.href = url;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
};
async function get(path) {
  const response = await fetch("/api/" + path);
  if (!response.ok) throw new Error("Katalog isteği başarısız (" + response.status + ").");
  return response.json();
}
function table(id, headers, rows) {
  const root = element(id);
  const table = make("table");
  const heading = table.createTHead().insertRow();
  for (const text of headers) {
    const th = make("th", text);
    th.scope = "col";
    heading.append(th);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const value of row) {
      const cell = tr.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value ?? "—";
    }
  }
  root.replaceChildren(rows.length ? table : make("p", "Kayıt yok."));
}
const fail = e => { element("error").textContent = e.message; };
async function show(id) {
  const detail = await get("editions/" + id);
  element("detail").hidden = false;
  element("detail-title").textContent = detail.item.fields.title + " · Eser " + detail.work.work_id;
  table("evidence", ["Alan","Kaynak değeri","Katalog değeri","Kaynak","Alan yolu","Vefeyât","Seçili"], detail.evidence.map(r => {
    const authority = r.authority && JSON.parse(r.authority);
    return [r.field,r.observed,r.value,link(r.url,r.source+" / "+r.external_id),r.path,authority ? link(authority.url,authority.path) : "—",r.selected ? "Evet" : "—"];
  }));
  table("edition-validation", ["Kod","Düzey","Açıklama","İlgili baskı"], detail.validation.map(r =>
    [r.code,r.level,r.detail,r.target_id && r.target_id !== id ? detailButton(r.target_id,r.target_id) : "—"]));
  element("detail").scrollIntoView({block:"start"});
}
function detailButton(id, label) {
  const button = make("button",label);
  button.type = "button";
  button.onclick = () => show(id).catch(fail);
  return button;
}
function paging(buttonId, path, callback) {
  const button = element(buttonId);
  let cursor = 0;
  async function next() {
    button.disabled = true;
    const rows = await get(path + "?after=" + cursor);
    callback(rows);
    if (rows.length) cursor = rows.at(-1).id;
    button.disabled = rows.length < 25;
  }
  button.onclick = () => next().catch(fail);
  return next();
}
async function start() {
  const s = await get("stats");
  const labels = {works:"Eser",editions:"Baskı",raw:"Ham kayıt",authority:"Vefeyât eşleşmesi"};
  element("metrics").replaceChildren(...Object.entries(s.counts).map(([key,n]) => {
    const card=make("div");
    card.append(make("span",labels[key]),make("strong",num.format(n)));
    return card;
  }));
  table("sources",["Kaynak","Arşivleme dayanağı","Ham","Baskı","Eşleşen","İnceleme","Kapsam dışı"],
    s.sources.map(r => [link(r.policy,r.name),r.license,r.raw,r.editions,r.matched,r.review,r.outside]));
  table("missing",["Alan","Eksik baskı","Oran"],s.missing.map(r => [r.field,r.count,r.rate === null ? "—" : percent.format(r.rate)]));
  table("validation",["Kod","Düzey","Sayı"],s.validation.map(r => [r.code,r.level,r.count]));
  table("jobs",["Kaynak","Anlık görüntü","Konum","Durum","İstanbul saati"],s.jobs.map(r => [r.source,r.label,r.cursor,r.state,dateTime.format(new Date(r.updated_at.replace(" ","T")+"Z"))]));
  await Promise.all([
    paging("review-next","review",rows => table("review",["Ham kayıt","Başlık","Kaynak","Kod","Açıklama","Olası baskı"],
      rows.map(r => [r.raw_id,r.title,link(r.url,r.source+" / "+r.external_id),r.code,r.detail,r.target_id ? detailButton(r.target_id,r.target_id) : "—"]))),
    paging("edition-next","editions",rows => table("editions",["Baskı","Eser","Başlık","Yayınevi","Tarih","ISBN"],
      rows.map(r => [detailButton(r.id,r.id),r.work_id,r.title,r.publisher,r.date,r.ISBN])))
  ]);
}
start().catch(fail);
`;

export function serve(db: Catalog, port: number) {
  const server = createServer((req, res) => {
    const send = (status: number, type: string, body: string) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(body);
    };
    const json = (value: unknown, status = 200) => send(status, "application/json; charset=utf-8", JSON.stringify(value));
    if (req.method !== "GET") { json({ error: "Yalnız GET desteklenir." }, 405); return; }
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const after = Number(url.searchParams.get("after") ?? "0");
      if (!Number.isSafeInteger(after) || after < 0) { json({ error: "Geçersiz konum." }, 400); return; }
      if (url.pathname === "/") send(200, "text/html; charset=utf-8", page);
      else if (url.pathname === "/panel.js") send(200, "text/javascript; charset=utf-8", script);
      else if (url.pathname === "/api/stats") json(db.stats());
      else if (url.pathname === "/api/review") json(db.review(after, 25));
      else if (url.pathname === "/api/editions") json(db.ids(after, 25).map(r => {
        const { title, date, publisher, ISBN } = db.item(r.id)!.fields;
        return { ...r, title, date, publisher, ISBN };
      }));
      else if (/^\/api\/editions\/[1-9]\d*$/.test(url.pathname)) {
        const detail = db.details(Number(url.pathname.split("/").pop()));
        json(detail, detail ? 200 : 404);
      } else json({ error: "Bulunamadı." }, 404);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) json({ error: "Katalog okunamadı." }, 500);
    }
  });
  server.once("close", () => db.close());
  server.listen(port, "127.0.0.1", () => console.log(`Derkenar yönetim paneli http://127.0.0.1:${port}`));
  return server;
}
