import { emptyState, planRefresh, putCitation } from "../core/docstate.js";
import { Renderer } from "../core/engine.js";
import { htmlToText } from "../core/html.js";
import type { Item } from "../core/zotero.js";

export function renderEdition(item: Item, readStyle: (filename: string) => string,
  locators: { first?: string; later?: string; volume?: string } = {}) {
  const renderer = new Renderer(readStyle("isnad-dipnotlu.csl"), l =>
    ["tr-TR", "en-US"].includes(l) ? readStyle(`locales-${l}.xml`) : undefined);
  const st = emptyState();
  const ref = { id: item.key, volume: locators.volume };
  const citationItem = { ...item, fields: { ...item.fields } };
  if (citationItem.fields.edition === "1") delete citationItem.fields.edition;
  putCitation(st, "first", [{ ...ref, locator: locators.first }], { [item.key]: citationItem });
  putCitation(st, "later", [{ ...ref, locator: locators.later }], {});
  const plan = planRefresh(st, [{ id: "first", noteIndex: 1, text: "" }, { id: "later", noteIndex: 2, text: "" }], renderer);
  return {
    first: htmlToText(plan.updates.get("first") ?? ""),
    later: htmlToText(plan.updates.get("later") ?? ""),
    bibliography: plan.bibliography?.entries.map(x => htmlToText(x.html)) ?? [],
  };
}
