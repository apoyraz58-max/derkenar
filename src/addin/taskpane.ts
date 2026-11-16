/**
 * Derkenar pane entry: wiring and what the ribbon buttons ask for (?action=…).
 */
import { BUILTIN_STYLES } from "../core/styles.js";
import * as word from "./word.js";
import { clearBasket, onSelection, search, wireCite } from "./pane/cite.js";
import { runCheck, wireCheck } from "./pane/check.js";
import { $, doc, loadLibrary, onLibraryChange, onShow, renderSummary, run, showView } from "./pane/core.js";
import { bibliography, changeStyle, nudge, refresh, renderDocList, startWatcher, wireDocument } from "./pane/document.js";
import { wireEditor } from "./pane/editor.js";
import { renderPushCount, renderSources, restoreZoteroForm, wireIo } from "./pane/io.js";
import { newItem, refreshLibraryView, wireLibrary } from "./pane/library.js";

declare const __VERSION__: string;

async function launch(action: string): Promise<void> {
  switch (action) {
    case "library":
      return showView("kutuphane");
    case "new":
      return newItem("book");
    case "import":
      showView("aktar");
      return void $("file").focus();
    case "identifier":
      showView("aktar");
      return void $("lookup").focus();
    case "export":
      showView("aktar");
      return void $("ex-format").focus();
    case "document":
    case "prefs":
      return showView("belge");
    case "refresh":
      showView("belge");
      return void (await run("Belge güncelleniyor", () => refresh(true)));
    case "bib":
      showView("belge");
      return void (await run("Kaynakça hazırlanıyor", bibliography));
    case "unlink":
      showView("belge");
      return void $("unlink").focus();
    case "check-doc":
      $<HTMLSelectElement>("chk-scope").value = "document";
      showView("denetim");
      return runCheck();
    case "check-lib":
      $<HTMLSelectElement>("chk-scope").value = "library";
      showView("denetim");
      return runCheck();
    default:
      if (action.startsWith("style:") && BUILTIN_STYLES.some((s) => s.id === action.slice(6))) {
        showView("belge");
        return void (await run("Stil uygulanıyor", () => changeStyle(action.slice(6))));
      }
      clearBasket();
      showView("atif");
  }
}

Office.onReady(async () => {
  $("version").textContent = `Derkenar ${__VERSION__}`;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button")) b.onclick = () => showView(b.dataset.view!);
  $("go-new").onclick = () => newItem("book");
  $("go-import").onclick = () => showView("aktar");
  wireCite();
  wireLibrary();
  wireEditor();
  wireDocument();
  wireCheck();
  wireIo();
  onShow("atif", () => $<HTMLInputElement>("q").focus());
  onShow("kutuphane", refreshLibraryView);
  onShow("belge", renderDocList);
  onShow("aktar", () => (renderSources(), renderPushCount()));
  onLibraryChange(() => {
    renderSummary();
    if (!$("view-atif").hidden) search();
    if (!$("view-kutuphane").hidden) refreshLibraryView();
    if (!$("view-aktar").hidden) renderSources();
  });
  doc();
  await loadLibrary();
  void restoreZoteroForm();
  word.onSelectionChanged(() => {
    window.clearTimeout(selTimer);
    selTimer = window.setTimeout(() => void onSelection(), 150);
    nudge();
  });
  await launch(new URLSearchParams(location.search).get("action") ?? "insert");
  search();
  startWatcher();
  void onSelection();
});
let selTimer = 0;
