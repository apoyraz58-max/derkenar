import { readFileSync } from "node:fs";
import { diaCreator, readCsv, type Person } from "../core/persons.js";
import { creatorFull, type Creator } from "../core/zotero.js";
import { digest, equivalent, type Attribution } from "./model.js";

export interface AuthorityMatch {
  creator: Creator;
  url: string;
  path: string;
  snapshot: string;
}

export function loadAuthority(file: string) {
  const content = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const snapshot = digest(content);
  const [header, ...rows] = readCsv(content);
  const index = new Map<string, Set<Person>>();
  const short = header?.indexOf("Kısa Ad") ?? -1;
  const full = header?.indexOf("Tam Ad") ?? -1;
  const link = header?.indexOf("Kaynak Link") ?? -1;
  if (Math.min(short, full, link) < 0) throw new Error("Vefeyât katalog sütunları bulunamadı.");

  for (const row of rows) {
    const dia = row[short];
    const url = row[link];
    if (!dia || !url?.startsWith("https://")) continue;
    const diaFull = row[full]?.replace(/^[-–—]+$/, "") || undefined;
    const person: Person = { dia, diaFull, link: url, ei3: "", group: "" };
    for (const alias of [dia, diaFull].filter(Boolean)) {
      const key = equivalent(alias!);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key)!.add(person);
    }
  }

  const lookup = (attribution: Attribution): AuthorityMatch | null => {
    if (attribution.kind === "organization") return null;
    const { creator } = attribution;
    const original = creatorFull(creator);
    const key = equivalent(original);
    const matches = index.get(key);
    if (matches?.size !== 1) return null;
    const [person] = matches;
    if (!person?.link || (!key.includes(" ") && attribution.kind !== "person")) return null;
    return {
      creator: diaCreator(creator, person),
      url: person.link,
      path: equivalent(person.dia) === key ? "Kısa Ad" : "Tam Ad",
      snapshot,
    };
  };
  return Object.assign(lookup, { snapshot });
}

export type Authority = ReturnType<typeof loadAuthority>;
