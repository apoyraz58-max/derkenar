/**
 * Transkripsiyonsuz yazım: a title transcribed the DİA/İSNAD way, written
 * without the transcription marks — as DİA writes names in running text.
 *
 *   transkripsiyonlu   Câmiʿu’ṣ-ṣaḥîḥ · Aʿyânü’l-ʿaṣr · İġās̱etü’l-lehfân · Fevâʾid · Ḳurʾân
 *   transkripsiyonsuz  Câmiu’s-sahîh  · A‘yânü’l-asr  · İğâsetü’l-lehfân  · Fevâid · Kur’ân
 *
 * The long vowels (â, î, û) stay; the dotted letters become plain (ḳ → k, ġ → ğ,
 * s̱ → s …); ayn is written ‘ and hamza ’ (DİA's signs in names: "Mes‘ûd",
 * "Me’mûn"), but neither at a word's start ("ʿİlel" → "İlel"), nor after a long
 * vowel ("Fevâʾid" → "Fevâid"), nor before a case ending joined to the article
 * ("Câmiʿu’l-beyân" → "Câmiu’l-beyân").
 */
const LETTERS: Record<string, string> = { ḥ: "h", Ḥ: "H", ḫ: "h", Ḫ: "H", ṣ: "s", Ṣ: "S", ż: "z", Ż: "Z", ḍ: "d", Ḍ: "D", ṭ: "t", Ṭ: "T", ẓ: "z", Ẓ: "Z", ẕ: "z", Ẕ: "Z", ḳ: "k", Ḳ: "K", ġ: "ğ", Ġ: "Ğ", ā: "â", Ā: "Â", ī: "î", Ī: "Î", ū: "û", Ū: "Û", ẖ: "h" };

/** Whether a text is written with transcription marks at all. */
export function isTranscribed(s: string): boolean {
  return /[ḥḫṣżḍṭẓẕḳġāīūẖḤḪṢŻḌṬẒẔḲĠĀĪŪʿʾ\u0331]/u.test(s.normalize("NFC"));
}

export function plainTranscription(s: string): string {
  if (!isTranscribed(s)) return s;
  let t = s.normalize("NFC").replace(/̱/g, "");
  t = t
    .replace(/(^|[\s(“"’-])[ʿʾ]/gu, "$1")
    .replace(/([âîûāīūÂÎÛĀĪŪ])[ʿʾ]/gu, "$1")
    .replace(/[ʿʾ](?=[uüiı]’)/gu, "")
    .replace(/ʿ/g, "‘")
    .replace(/ʾ/g, "’");
  return [...t].map((ch) => LETTERS[ch] ?? ch).join("");
}
