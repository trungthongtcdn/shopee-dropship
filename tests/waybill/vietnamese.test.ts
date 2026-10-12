import { describe, it, expect } from "vitest";
import {
  isKnownWord,
  isSyllableRun,
  isVietnameseSyllable,
  looksCamelCase,
  separateBrands,
  syllableBreak,
} from "@/lib/waybill/vietnamese";

describe("isVietnameseSyllable", () => {
  it.each(["thước", "dây", "chất", "nghiêng", "quyền", "khuya", "ví", "đen", "xà", "Đế", "NAU", "nau", "da", "vi", "ốc", "bánh", "xe"])(
    "knows %j for a syllable",
    (token) => expect(isVietnameseSyllable(token)).toBe(true)
  );

  it.each(["thướcdây", "hyun", "k", "nda", "hyundai", "hôn" + "hợp", "123", "a1", "", "xyz"])("does not take %j for one", (token) =>
    expect(isVietnameseSyllable(token)).toBe(false)
  );
});

describe("isSyllableRun", () => {
  it("reads syllables back to back", () => {
    expect(isSyllableRun("vidanau")).toBe(true);
    expect(isSyllableRun("ĐEN")).toBe(true);
    expect(isSyllableRun("thướcdây")).toBe(true);
  });
  it("refuses what has a stretch no syllable covers", () => {
    expect(isSyllableRun("K")).toBe(false);
    expect(isSyllableRun("D160")).toBe(false);
    expect(isSyllableRun("xyzw")).toBe(false);
  });
});

describe("isKnownWord", () => {
  it("knows brands whatever their case and marks", () => {
    expect(isKnownWord("HYUNDAI")).toBe(true);
    expect(isKnownWord("Huyndai")).toBe(true);
    expect(isKnownWord("Vinfast")).toBe(true);
    expect(isKnownWord("ghế")).toBe(false);
  });
});

describe("syllableBreak", () => {
  it("says space where two syllables meet that make no syllable together", () => {
    expect(syllableBreak("Thước", "dây,")).toBe("space");
    expect(syllableBreak("da", "nau")).toBe("space");
    expect(syllableBreak("hỗn", "hợp")).toBe("space");
    expect(syllableBreak("(Văn", "phòng")).toBe("space");
  });

  it("says glue where the halves make one syllable and a half is not one", () => {
    expect(syllableBreak("chấ", "t")).toBe("glue");
    expect(syllableBreak("R", "EN")).toBe("glue");
    expect(syllableBreak("thu", "oc")).toBeNull(); // both halves are syllables and so is the whole: no telling
  });

  it("keeps a borrowed word whole", () => {
    expect(syllableBreak("lo", "go")).toBe("glue");
    expect(syllableBreak("com", "bo")).toBe("glue");
    expect(syllableBreak("huyn", "dai")).toBe("glue");
    expect(syllableBreak("Ho", "nda")).toBe("glue");
  });

  it("gives no verdict on codes, numbers or foreign fragments", () => {
    expect(syllableBreak("Bo_0", "5Ban")).toBeNull();
    expect(syllableBreak("FREESHI", "P")).toBeNull();
    expect(syllableBreak("Pis", "ton")).toBeNull();
    expect(syllableBreak("20", "40")).toBeNull();
  });

  it("gives no verdict inside a camel-case code", () => {
    expect(syllableBreak("ChanG", "he")).toBeNull();
    expect(syllableBreak("ĐếXà", "Đen")).toBeNull();
  });
});

describe("looksCamelCase", () => {
  it("is a lower-case letter then a capital", () => {
    expect(looksCamelCase("Chan", "Ghe")).toBe(true);
    expect(looksCamelCase("ĐếXà", "Đen")).toBe(true);
  });
  it("is not anything else", () => {
    expect(looksCamelCase("ĐEN", "HYU")).toBe(false);
    expect(looksCamelCase("nau", "huyn")).toBe(false);
    expect(looksCamelCase("Bo_0", "5Ban")).toBe(false);
  });
});

describe("separateBrands", () => {
  it("pulls a brand back from the syllable before it when a wrap glued them", () => {
    const text = "VÍ ĐENHYUNDAI";
    expect(separateBrands(text, [text.indexOf("HYU")])).toBe("VÍ ĐEN HYUNDAI");
  });

  it("does so after several syllables too", () => {
    const text = "Vidanauhuyndai";
    expect(separateBrands(text, [text.indexOf("huyn")])).toBe("Vidanau huyndai");
  });

  it("leaves a word the seller wrote as one — only a glued line break can be a lost space", () => {
    expect(separateBrands("BoHyundai", [])).toBe("BoHyundai");
  });

  it("leaves it when what comes before is not syllables, or what follows is not a brand", () => {
    const a = "5-hyundai";
    expect(separateBrands(a, [2])).toBe(a);
    const b = "ĐENXYZ";
    expect(separateBrands(b, [3])).toBe(b);
    const c = "Stanford";
    expect(separateBrands(c, [4])).toBe(c);
  });
});
