// Generates manifest/manifest.template.xml (the Künye ribbon tab and context menu).
// Run after changing the ribbon:  node scripts/manifest.mjs
// build.mjs fills in {{BASE_URL}} and {{VERSION}}.
import { writeFile } from "node:fs/promises";

const B = "{{BASE_URL}}";
const STYLES = [
  ["isnad-dipnotlu", "İSNAD 2 (dipnotlu)"],
  ["isnad-metinici", "İSNAD 2 (metin içi)"],
  ["apa", "APA 7"],
  ["chicago-notes-bibliography", "Chicago 18 (dipnot)"],
  ["chicago-author-date", "Chicago 18 (yazar-tarih)"],
  ["modern-language-association", "MLA 9"],
  ["harvard-cite-them-right", "Harvard"],
  ["ieee", "IEEE"],
];

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
const pane = (url, ind) => `${ind}<Action xsi:type="ShowTaskpane">\n${ind}  <TaskpaneId>KunyePane</TaskpaneId>\n${ind}  <SourceLocation resid="${url}"/>\n${ind}</Action>\n`;

function button(id, label, tip, ic, action, ind = " ".repeat(16), tag = "Control") {
  const kind = tag === "Control" ? ' xsi:type="Button"' : "";
  return `${ind}<${tag}${kind} id="Kunye.${id}">\n${head(S(id, label), L(`${id}.Tip`, tip), ind + "  ")}${icon(ic, ind + "  ")}${pane(U(`U.${id}`, action), ind + "  ")}${ind}</${tag}>\n`;
}

function group(id, label, ic, controls) {
  const ind = " ".repeat(14);
  return `${ind}<Group id="Kunye.G.${id}">\n${ind}  <Label resid="${S(`G.${id}`, label)}"/>\n${icon(ic, ind + "  ")}${controls.join("")}${ind}</Group>\n`;
}

const styleTip = L("Style.Tip", "Belgenin atıf stilini değiştirir; bütün atıflar ve kaynakça yeni stile göre yeniden yazılır.");
const styleMenu =
  `                <Control xsi:type="Menu" id="Kunye.Style">\n${head(S("Style", "Stil"), styleTip, " ".repeat(18))}${icon("settings", " ".repeat(18))}                  <Items>\n` +
  STYLES.map(([id, title], i) => {
    const ind = " ".repeat(20);
    return `${ind}<Item id="Kunye.Style.${i}">\n${head(S(`Style.${i}`, title), styleTip, ind + "  ")}${icon("settings", ind + "  ")}${pane(U(`U.Style.${i}`, `style:${id}`), ind + "  ")}${ind}</Item>\n`;
  }).join("") +
  `                  </Items>\n                </Control>\n`;

const tab = [
  group("Cite", "Atıf", "insert", [
    button("Insert", "Atıf ekle", "Künye penceresini açar: kaynağı arayın, sayfayı yazın, Ctrl+Enter ile atıfı ekleyin. Dipnotlu stillerde atıf yeni bir dipnota girer.", "insert", "insert"),
    button("Bib", "Kaynakça", "İmlecin bulunduğu yere kaynakça ekler; varsa günceller. Kaynakça atıflarla birlikte kendiliğinden güncellenir.", "index", "bib"),
    button("Refresh", "Güncelle", "Bütün atıfları ve kaynakçayı seçili stile göre yeniden yazar (ilk atıf tam, sonrakiler kısa).", "consistency", "refresh"),
  ]),
  group("Style", "Stil", "settings", [styleMenu]),
  group("Library", "Kaynaklar", "catalog", [
    button("Library", "Kütüphane", "Zotero kütüphanenizi eşitleyin; BibTeX, RIS, CSL JSON dosyası içe aktarın; DOI/ISBN ile ya da elle kaynak ekleyin.", "catalog", "library"),
    button("Document", "Belgedeki atıflar", "Belgedeki atıfların listesi, stil ve dil seçimi.", "report", "document"),
  ]),
  group("Final", "Teslim", "finalize", [button("Unlink", "Düz metne çevir", "Teslimden önce atıfları ve kaynakçayı düz metne çevirir. Önce belgenin bir kopyasını alın.", "finalize", "unlink")]),
];

const contextMenu = [
  button("Ctx.Insert", "Atıf ekle", "Künye penceresinde kaynak arayıp imlecin bulunduğu yere atıf ekler.", "insert", "insert", " ".repeat(16), "Control"),
];

const resources = () => {
  const imgs = [...icons].flatMap((n) => [16, 32, 80].map((s) => `        <bt:Image id="Ic.${n}.${s}" DefaultValue="${B}assets/icons/${n}-${s}.png"/>`));
  imgs.push(`        <bt:Image id="Icon.16" DefaultValue="${B}assets/icon-16.png"/>`, `        <bt:Image id="Icon.32" DefaultValue="${B}assets/icon-32.png"/>`, `        <bt:Image id="Icon.80" DefaultValue="${B}assets/icon-80.png"/>`);
  const u = [...urls].map(([k, v]) => `        <bt:Url id="${k}" DefaultValue="${esc(v)}"/>`);
  u.push(`        <bt:Url id="Commands.Url" DefaultValue="${B}commands.html"/>`, `        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="https://github.com/apoyraz58-max/kunye"/>`);
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
        <bt:String id="GetStarted.Title" DefaultValue="Künye hazır"/>
        <bt:String id="Tab" DefaultValue="Künye"/>
        <bt:String id="Ctx" DefaultValue="Künye"/>
${[...short].map(([k, v]) => `        <bt:String id="${k}" DefaultValue="${esc(v)}"/>`).join("\n")}
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Üstteki Künye sekmesinden Atıf ekle düğmesine basın; önce Kütüphane'den Zotero'yu bağlayın veya bir dosya içe aktarın."/>
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
  <Id>3d0f8a52-6c1e-4b7d-a9f4-58e2c71b04ad</Id>
  <Version>{{VERSION}}</Version>
  <ProviderName>Künye</ProviderName>
  <DefaultLocale>tr-TR</DefaultLocale>
  <DisplayName DefaultValue="Künye"/>
  <Description DefaultValue="Word için hızlı atıf ve kaynakça: Zotero kütüphanesi, İSNAD, APA, Chicago ve diğer CSL stilleri."/>
  <IconUrl DefaultValue="${B}assets/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="${B}assets/icon-64.png"/>
  <SupportUrl DefaultValue="https://github.com/apoyraz58-max/kunye"/>
  <AppDomains>
    <AppDomain>https://api.zotero.org</AppDomain>
    <AppDomain>https://api.crossref.org</AppDomain>
    <AppDomain>https://openlibrary.org</AppDomain>
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
            <CustomTab id="Kunye.Tab">
${tabXml}              <Label resid="Tab"/>
            </CustomTab>
          </ExtensionPoint>
          <ExtensionPoint xsi:type="ContextMenu">
            <OfficeMenu id="ContextMenuText">
              <Control xsi:type="Menu" id="Kunye.Ctx">
                <Label resid="Ctx"/>
                <Supertip>
                  <Title resid="Ctx"/>
                  <Description resid="Ctx.Insert.Tip"/>
                </Supertip>
                <Icon>
                  <bt:Image size="16" resid="Icon.16"/>
                  <bt:Image size="32" resid="Icon.32"/>
                  <bt:Image size="80" resid="Icon.80"/>
                </Icon>
                <Items>
${ctxXml.replace('<Control xsi:type="Button" id="Kunye.Ctx.Insert">', '<Item id="Kunye.Ctx.Insert">').replace(/<\/Control>\n$/, "</Item>\n").replace(/^/gm, "  ")}                </Items>
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
