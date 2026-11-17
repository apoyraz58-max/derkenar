// Generates manifest/manifest.template.xml (the Derkenar ribbon tab and context menu).
// Run after changing the ribbon:  node scripts/manifest.mjs
// build.mjs fills in {{BASE_URL}} and {{VERSION}}.
import { writeFile } from "node:fs/promises";

const B = "{{BASE_URL}}";


const short = new Map();
const long = new Map();
const urls = new Map();
const icons = new Set();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const S = (k, v) => (short.set(k, v), k);
const L = (k, v) => (long.set(k, v), k);
const U = (k, action) => (urls.set(k, `${B}taskpane.html?action=${action}`), k);

const icon = (name, ind) => {
  icons.add(name);
  return `${ind}<Icon>\n${[16, 32, 80].map((s) => `${ind}  <bt:Image size="${s}" resid="Ic.${name}.${s}"/>\n`).join("")}${ind}</Icon>\n`;
};
const head = (label, tip, ind) => `${ind}<Label resid="${label}"/>\n${ind}<Supertip>\n${ind}  <Title resid="${label}"/>\n${ind}  <Description resid="${tip}"/>\n${ind}</Supertip>\n`;
const pane = (url, ind) => `${ind}<Action xsi:type="ShowTaskpane">\n${ind}  <TaskpaneId>Office.AutoShowTaskpaneWithDocument</TaskpaneId>\n${ind}  <SourceLocation resid="${url}"/>\n${ind}</Action>\n`;

function button(id, label, tip, ic, action, ind = " ".repeat(16), tag = "Control") {
  const kind = tag === "Control" ? ' xsi:type="Button"' : "";
  return `${ind}<${tag}${kind} id="Derkenar.${id}">\n${head(S(id, label), L(`${id}.Tip`, tip), ind + "  ")}${icon(ic, ind + "  ")}${pane(U(`U.${id}`, action), ind + "  ")}${ind}</${tag}>\n`;
}

function group(id, label, ic, controls) {
  const ind = " ".repeat(14);
  return `${ind}<Group id="Derkenar.G.${id}">\n${ind}  <Label resid="${S(`G.${id}`, label)}"/>\n${icon(ic, ind + "  ")}${controls.join("")}${ind}</Group>\n`;
}

const tab = [
  group("Cite", "Atıf", "insert", [
    button("Insert", "Atıf Ekle/Düzenle", "İmlecin olduğu yere atıf ekler; imleç bir atıfın içindeyse onu düzenler. Dipnotlu İSNAD'da atıf yeni dipnota girer, ilk atıf tam, sonrakiler kısa yazılır.", "brand-add", "insert"),
    button("Bib", "Kaynakça Ekle/Düzenle", "İmlecin olduğu yere kaynakça ekler; varsa günceller. Kaynakça atıflarla birlikte kendiliğinden güncellenir.", "index", "bib"),
    button("Prefs", "Belge Tercihleri", "Atıf stili (İSNAD 2 dipnotlu / metin içi), dil, dipnot ya da sonnot, otomatik güncelleme.", "settings", "prefs"),
    button("Refresh", "Güncelle", "Bütün atıfları ve kaynakçayı yeniden yazar. Otomatik güncelleme açıkken genellikle gerekmez.", "consistency", "refresh"),
    button("Unlink", "Düz Metne Çevir", "Teslimden önce atıfları ve kaynakçayı düz metne çevirir. Önce belgenin bir kopyasını alın.", "finalize", "unlink"),
  ]),
  group("Library", "Kütüphane", "library", [
    button("Library", "Kütüphane", "Kaynaklar, koleksiyonlar, etiketler, notlar, çöp kutusu ve yinelenenler: hepsi bu pencerede.", "library", "library"),
    button("New", "Yeni Kaynak", "Kaynak ekleme yolları: DOI, ISBN, PMID, arXiv ile; RIS, BibTeX metni yapıştırarak; dosyadan; ya da elle (muhakkik, nâşir, hazırlayan dahil bütün alanlar).", "bulk", "new"),
    button("Import", "İçe Aktar", "Dışa aktarılmış kütüphaneyi alır: RDF, CSL JSON, BibTeX, RIS. Ya da çevrimiçi kütüphaneyle eşitler.", "csv", "import"),
    button("Export", "Dışa Aktar", "Kütüphaneyi, bir koleksiyonu ya da belgedeki kaynakları Derkenar yedeği, CSL JSON, RIS veya BibTeX olarak verir.", "source", "export"),
  ]),
  group("Isnad", "İSNAD", "audit", [
    button("CheckDoc", "Belgeyi Denetle", "Bu belgede atıf yapılan kaynakları İSNAD 2 yazım kurallarına göre denetler; düzeltilebilenleri tek tıkla düzeltir.", "audit", "check-doc"),
    button("CheckLib", "Kütüphaneyi Denetle", "Bütün kütüphaneyi İSNAD 2 yazım kurallarına göre denetler.", "health", "check-lib"),
  ]),
  group("Data", "Veri ve yardım", "info", [
    button("Info", "Veri bilgisi", "Kütüphanenin ve bu belgenin verilerini gösterir: kaynak sayıları, nerede saklandığı, belgedeki kopya, eşitleme, sürüm.", "info", "info"),
    button("Help", "Kullanım kılavuzu", "Derkenar komutlarının kısa kılavuzu, İSNAD'a özgü ayrıntılar ve Hakkında.", "brand", "help"),
  ]),
];

const contextMenu = [
  button("Ctx.Insert", "Atıf ekle", "Derkenar penceresinde kaynak arayıp imlecin bulunduğu yere atıf ekler.", "brand-add", "insert", " ".repeat(16), "Control"),
];

const resources = () => {
  const imgs = [...icons].flatMap((n) => [16, 32, 80].map((s) => `        <bt:Image id="Ic.${n}.${s}" DefaultValue="${B}assets/icons/${n}-${s}.png"/>`));
  const u = [...urls].map(([k, v]) => `        <bt:Url id="${k}" DefaultValue="${esc(v)}"/>`);
  u.push(`        <bt:Url id="Commands.Url" DefaultValue="${B}commands.html"/>`, `        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="https://github.com/apoyraz58-max/derkenar"/>`);
  for (const [k, v] of short) if (v.length > 125) throw new Error(`short string too long: ${k}`);
  for (const [k, v] of long) if (v.length > 250) throw new Error(`long string too long: ${k}`);
  return `    <Resources>
      <bt:Images>
${imgs.join("\n")}
      </bt:Images>
      <bt:Urls>
${u.join("\n")}
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="Derkenar hazır"/>
        <bt:String id="Tab" DefaultValue="Derkenar"/>
        <bt:String id="Ctx" DefaultValue="Derkenar"/>
${[...short].map(([k, v]) => `        <bt:String id="${k}" DefaultValue="${esc(v)}"/>`).join("\n")}
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Üstteki Derkenar sekmesinde önce İçe Aktar ile kütüphanenizi alın ya da Yeni Kaynak ile girin; sonra Atıf Ekle/Düzenle."/>
${[...long].map(([k, v]) => `        <bt:String id="${k}" DefaultValue="${esc(v)}"/>`).join("\n")}
      </bt:LongStrings>
    </Resources>
`;
};

const tabXml = tab.join("");
const ctxXml = contextMenu.join("");
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generated by scripts/manifest.mjs; rendered by scripts/build.mjs ({{BASE_URL}}, {{VERSION}}). -->
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
           xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides"
           xsi:type="TaskPaneApp">
  <Id>8b2e4f17-3a9c-4d65-b0e1-7c54d29a6f38</Id>
  <Version>{{VERSION}}</Version>
  <ProviderName>Derkenar</ProviderName>
  <DefaultLocale>tr-TR</DefaultLocale>
  <DisplayName DefaultValue="Derkenar"/>
  <Description DefaultValue="Word için atıf ve kaynakça yöneticisi: kaynak kütüphanesi, otomatik dipnot güncelleme, atıf stili ve yazım denetimi."/>
  <IconUrl DefaultValue="${B}assets/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="${B}assets/icon-64.png"/>
  <SupportUrl DefaultValue="https://github.com/apoyraz58-max/derkenar"/>
  <AppDomains>
    <AppDomain>https://api.zotero.org</AppDomain>
    <AppDomain>https://api.crossref.org</AppDomain>
    <AppDomain>https://openlibrary.org</AppDomain>
    <AppDomain>https://sru.k10plus.de</AppDomain>
    <AppDomain>https://services.dnb.de</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Document"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.3">
      <Set Name="WordApi" MinVersion="1.3"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${B}taskpane.html"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Document">
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <FunctionFile resid="Commands.Url"/>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <CustomTab id="Derkenar.Tab">
${tabXml}              <Label resid="Tab"/>
            </CustomTab>
          </ExtensionPoint>
          <ExtensionPoint xsi:type="ContextMenu">
            <OfficeMenu id="ContextMenuText">
              <Control xsi:type="Menu" id="Derkenar.Ctx">
                <Label resid="Ctx"/>
                <Supertip>
                  <Title resid="Ctx"/>
                  <Description resid="Ctx.Insert.Tip"/>
                </Supertip>
                <Icon>
                  <bt:Image size="16" resid="Ic.brand.16"/>
                  <bt:Image size="32" resid="Ic.brand.32"/>
                  <bt:Image size="80" resid="Ic.brand.80"/>
                </Icon>
                <Items>
${ctxXml.replace('<Control xsi:type="Button" id="Derkenar.Ctx.Insert">', '<Item id="Derkenar.Ctx.Insert">').replace(/<\/Control>\n$/, "</Item>\n").replace(/^/gm, "  ")}                </Items>
              </Control>
            </OfficeMenu>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
${resources()}  </VersionOverrides>
</OfficeApp>
`;
await writeFile(new URL("../manifest/manifest.template.xml", import.meta.url), xml);
console.log("manifest/manifest.template.xml written");
