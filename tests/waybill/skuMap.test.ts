import { describe, it, expect } from "vitest";
import { parseSkuSheet, SkuMap, SkuSheetError, skuFoldKey, skuKey, toSkuRecords } from "@/lib/waybill/skuMap";

describe("skuKey", () => {
  it("drops every space and special character, keeping case and diacritics", () => {
    expect(skuKey("TyHoi_D160_Den")).toBe("TyHoiD160Den");
    expect(skuKey("Tui_20_Vit_HH & Tua_Vit_A")).toBe("Tui20VitHHTuaVitA");
    expect(skuKey("2P6 rèm Everest 2023 +")).toBe("2P6rèmEverest2023");
    expect(skuKey("K3 ( 13-18 )/L1")).toBe("K31318L1");
  });

  it("makes a decomposed accent and a composed one the same", () => {
    expect(skuKey("é")).toBe(skuKey("é"));
  });

  it("is empty for a SKU with nothing but symbols", () => {
    expect(skuKey("???")).toBe("");
    expect(skuKey(" _-+ ")).toBe("");
  });
});

describe("skuFoldKey", () => {
  it("also drops case and diacritics, đ included", () => {
    expect(skuFoldKey("4Vit_Ghế_Ngắn")).toBe("4vitghengan");
    expect(skuFoldKey("ví Đen HYUNDAI")).toBe("videnhyundai");
  });
});

describe("toSkuRecords", () => {
  it("lists each distinct SKU once, in first-seen order, with the rows that carry it", () => {
    const records = toSkuRecords(["B_1", "A 1", "B_1", "  A   1 ", "???"]);
    expect(records.map((r) => [r.sku, r.rows])).toEqual([
      ["B_1", 2],
      ["A 1", 2],
    ]);
    expect(records[0]).toMatchObject({ key: "B1", foldKey: "b1" });
  });

  it("writes an accent the composed way", () => {
    expect(toSkuRecords(["Ghe\u0302\u0301 1"]).map((r) => r.sku)).toEqual(["Ghế 1"]);
  });

  it("collapses a line break inside a SKU to a space", () => {
    expect(toSkuRecords(["CX5 rèm CX5 2018-2025\n L1"]).map((r) => r.sku)).toEqual(["CX5 rèm CX5 2018-2025 L1"]);
  });
});

describe("SkuMap", () => {
  const map = new SkuMap(
    toSkuRecords([
      "TyHoi_D160_Den",
      "1 Cặp Nút Trắng",
      "4Vit_Ghế_Ngắn",
      "1Vit_Ghe_Ngan",
      "ví Đen hyundai",
      // two spellings of one key: the one the list uses most wins
      "2P6 rèm Everest 2023 +",
      "2P6 rèm Everest 2023",
      "2P6 rèm Everest 2023 +",
      // ties go to the first
      "ép san 21 nâu",
      "ép san21 nâu",
    ])
  );

  it("finds the master spelling whatever spaces and symbols the label read had", () => {
    expect(map.resolve("TyHoiD160Den")).toBe("TyHoi_D160_Den");
    expect(map.resolve("TyHoi_D16" + "0_De" + "n")).toBe("TyHoi_D160_Den");
    expect(map.resolve("1CặpNútTrắng")).toBe("1 Cặp Nút Trắng");
    expect(map.resolve("TyHoi_D160_Den")).toBe("TyHoi_D160_Den");
  });

  it("falls back to ignoring case and diacritics", () => {
    expect(map.resolve("4Vit_Ghe_Ngan")).toBe("4Vit_Ghế_Ngắn");
    expect(map.resolve("VÍĐENHYUNDAI")).toBe("ví Đen hyundai");
  });

  it("prefers a match in case and diacritics over a looser one", () => {
    expect(map.resolve("1Vit_Ghe_Ngan")).toBe("1Vit_Ghe_Ngan");
  });

  it("never guesses a near match", () => {
    expect(map.resolve("2Vit_Ghe_Ngan")).toBeNull();
    expect(map.resolve("TyHoi_D161_Den")).toBeNull();
  });

  it("picks the spelling the list uses most when several share a key", () => {
    expect(map.resolve("2P6remEverest2023")).toBe("2P6 rèm Everest 2023 +");
    expect(map.resolve("ép san 21 nâu")).toBe("ép san 21 nâu");
  });

  it("finds nothing for a SKU with no letters or digits", () => {
    expect(map.resolve("")).toBeNull();
    expect(map.resolve("???")).toBeNull();
  });
});

describe("parseSkuSheet", () => {
  it("reads the column headed SKU, wherever it is", () => {
    const csv = ["STT,SKU,ghi chú", ',MocDen_QuaiDa,BD12.10', ',,BD12.10', ',"A, ""B""",', ""].join("\n");
    expect(parseSkuSheet(csv)).toEqual(["MocDen_QuaiDa", 'A, "B"']);
    expect(parseSkuSheet("note,sku\nx,Y 1\n")).toEqual(["Y 1"]);
  });

  it("keeps a line break inside a quoted cell and tolerates CRLF and a BOM", () => {
    const csv = '﻿STT,SKU,ghi chú\r\n,"CX5 rèm\n L1",\r\n,B,\r\n';
    expect(parseSkuSheet(csv)).toEqual(["CX5 rèm\n L1", "B"]);
  });

  it("refuses a sheet without a SKU column (a login page, the wrong tab)", () => {
    expect(() => parseSkuSheet("<!DOCTYPE html><html>sign in</html>")).toThrow(SkuSheetError);
    expect(() => parseSkuSheet("STT,Tên\n1,x")).toThrow(SkuSheetError);
  });
});
