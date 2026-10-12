// Written Vietnamese puts a space between every syllable, and a syllable has a fixed
// shape: [initial consonant] + vowel nucleus + [final consonant]. That is what tells a
// label's hard wrap that fell on a space ("Thước" / "dây": two syllables, "Thướcdây" is
// nothing) from one that fell inside a syllable ("chấ" / "t": only "chất" is a syllable).
// Only the shape is checked, on the letters without their marks, so unaccented text
// ("vi da nau") reads the same as accented. It is a test of form, not a dictionary.

const INITIALS = "ngh|ng|nh|ph|th|tr|ch|gh|gi|kh|qu|[bcdghklmnpqrstvx]";
const NUCLEI = [
  "a", "e", "i", "o", "u", "y",
  "ai", "ao", "au", "ay", "eo", "eu", "ia", "ie", "ieu", "iu", "oa", "oai", "oao", "oay", "oe", "oi", "oo",
  "ua", "uai", "uay", "ue", "ui", "uo", "uoi", "uu", "uy", "uya", "uye", "uyu", "ya", "ye", "yeu",
].join("|");
const FINALS = "ch|ng|nh|c|m|n|p|t";
const SYLLABLE = new RegExp(`^(?:${INITIALS})?(?:${NUCLEI})(?:${FINALS})?$`);

function plain(letters: string): string {
  return letters.toLowerCase().replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "");
}

// Words that are not Vietnamese but turn up in product names and SKUs — car and bike
// brands, and a few borrowed words made of syllable-shaped pieces ("lo" + "go"). They
// are never split by the shape test, and a brand glued to the syllable before it is
// pulled back apart ("ĐENHYUNDAI" → "ĐEN HYUNDAI"). Letters only, no marks, lower case.
const KNOWN_WORDS = new Set([
  "hyundai", "huyndai", "honda", "toyota", "mazda", "vinfast", "suzuki", "yamaha", "mitsubishi", "nissan",
  "mercedes", "lexus", "subaru", "peugeot", "chevrolet", "ford", "audi", "volvo", "isuzu", "daihatsu",
  "innova", "camry", "civic", "accord", "exciter", "winner", "sirius", "vespa", "piaggio",
  "logo", "combo", "mini", "taxi", "menu", "video", "karaoke",
]);

export function isKnownWord(token: string): boolean {
  return KNOWN_WORDS.has(plain(token));
}

// A run of letters that reads as one or more syllables back to back ("vidanau").
export function isSyllableRun(token: string): boolean {
  if (!/^\p{L}+$/u.test(token)) return false;
  const letters = plain(token);
  const reach: boolean[] = new Array(letters.length + 1).fill(false);
  reach[0] = true;
  for (let end = 1; end <= letters.length; end++) {
    for (let start = Math.max(0, end - 7); start < end; start++) {
      if (reach[start] && SYLLABLE.test(letters.slice(start, end))) {
        reach[end] = true;
        break;
      }
    }
  }
  return reach[letters.length];
}

// A token made of letters only: Vietnamese-shaped or not.
export function isVietnameseSyllable(token: string): boolean {
  return /^\p{L}+$/u.test(token) && SYLLABLE.test(plain(token));
}

// The word a line ends with / the next one starts with, for judging the break between
// them: only the far side is stripped of stuck-on punctuation ("(Thước" / "dây,"); the
// side that touches the break must be a letter, or there is nothing to judge ("Bo_0" /
// "5Ban" — the break falls between a digit and a digit). "" when it is not letters only.
function wordBefore(token: string): string {
  const word = token.replace(/^\P{L}+/u, "");
  return /^\p{L}+$/u.test(word) ? word : "";
}

function wordAfter(token: string): string {
  const word = token.replace(/\P{L}+$/u, "");
  return /^\p{L}+$/u.test(word) ? word : "";
}

// What the break between two lines says, judged by shape alone:
//   "space"  — both sides are syllables and the two together are not one;
//   "glue"   — together they are one syllable and a side alone is not (cut mid-syllable);
//   null     — no verdict (foreign words, codes, anything else).
export function syllableBreak(before: string, after: string): "space" | "glue" | null {
  const a = wordBefore(before);
  const b = wordAfter(after);
  if (!a || !b) return null;
  // A capital inside a word is a camel-case code ("ChanG|he"), not Vietnamese prose.
  if (/\p{Ll}\p{Lu}/u.test(a) || /\p{Ll}\p{Lu}/u.test(b)) return null;
  if (isKnownWord(a + b)) return "glue";
  const aOk = isVietnameseSyllable(a);
  const bOk = isVietnameseSyllable(b);
  const joinedOk = isVietnameseSyllable(a + b);
  if (aOk && bOk && !joinedOk) return "space";
  if (joinedOk && !(aOk && bOk)) return "glue";
  return null;
}

// `text` was put together from wrapped lines; `joins` are the positions in it where two lines
// were glued without a space. A join that sits in front of a known brand, right after
// whole syllables, was a space the wrap ate: "ĐEN|HYUNDAI" reads "ĐEN HYUNDAI".
export function separateBrands(text: string, joins: number[]): string {
  let result = text;
  for (const position of [...joins].sort((a, b) => b - a)) {
    const start = result.slice(0, position).search(/\S*$/);
    const rest = /^\S*/.exec(result.slice(position))![0];
    const left = result.slice(start, position).replace(/^\P{L}+/u, "");
    const right = rest.replace(/\P{L}+$/u, "");
    if (left && right && isSyllableRun(left) && isKnownWord(right)) {
      result = `${result.slice(0, position)} ${result.slice(position)}`;
    }
  }
  return result;
}

// A lower-case letter followed by a capital: where a SKU written in camel case
// ("ChanGhe", "TyHoi", "ĐếXà") has its seams. Two syllables with no space between are the
// seller's own spelling there, not a space the wrap ate.
export function looksCamelCase(before: string, after: string): boolean {
  const last = [...before.trimEnd()].pop() ?? "";
  const first = [...after.trimStart()][0] ?? "";
  const lower = last !== "" && last === last.toLowerCase() && last !== last.toUpperCase();
  const upper = first !== "" && first === first.toUpperCase() && first !== first.toLowerCase();
  return lower && upper;
}
