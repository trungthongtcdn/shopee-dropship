import { describe, it, expect } from "vitest";
import type { WaybillPage } from "@/lib/waybill/items";
import { applyKiotMap, KiotMap, parseComboSku, parseCost, parseKiotSheet } from "@/lib/waybill/kiotMap";

// Shape of the real "GIÁ FULL" tab: a blank first column, then the Kiot code, the store,
// the Shopee SKU, notes, unit, and one price column per month.
const SHEET = [
  ",mã hàng kiot,kho kiot,sku shopee,ghi chú,đơn vị TÍNH,Giá nhập MỚI NHẤT (t7),Giá nhập T6",
  ",1BanhXe,kho56,1BanhXe,,,4.150,4.650",
  ',Vi_Nau,kho56,"""ở các dòng phía cuối file""",.+túi,,11000,12800',
  ",Vi_Nau,kho56,Ví_Nâu_FORD,,,11000,",
  ",Vi_Nau,kho56,Ví_Nâu_MAZDA,,,11000,",
  ",quat10,khorem,Quạt 10,hộp + xốp,,109000,109000",
  ",,,,,,,",
  ",Xà_Đen_Thanh_Lý,kho56,,,,5.000,",
  ",,,Đổi_TypeC_ USB,,,,",
  ",Khan_To_Ong,kho56,Khan_To_Ong,,,9100,",
  ",Khan_To_Ong,khorem,Khan_To_Ong,,,9100,",
  ",1mOngBac100,kho56,1mOngBac100,,,10.200,",
  ",dai110,kho56,dai110,,,2.800,",
  ",NoPrice,kho56,NoPrice,,,,",
  ",Combo_AB,kho56,Combo_A*2+Combo_B,,,50000,",
].join("\n");

describe("parseCost", () => {
  it("reads a dot as the thousands separator", () => {
    expect(parseCost("4.150")).toBe(4150);
    expect(parseCost("1.234.567")).toBe(1234567);
    expect(parseCost("100000")).toBe(100000);
    expect(parseCost("383")).toBe(383);
  });

  it("reads a comma as the decimal mark and tolerates a currency sign", () => {
    expect(parseCost("3,4")).toBe(3.4);
    expect(parseCost("4.150,50")).toBe(4150.5);
    expect(parseCost("4.150 đ")).toBe(4150);
  });

  it("returns null for anything that isn't a price", () => {
    expect(parseCost("")).toBeNull();
    expect(parseCost("còn tồn chưa cập nhật")).toBeNull();
    expect(parseCost("12a")).toBeNull();
  });
});

describe("parseKiotSheet", () => {
  const records = parseKiotSheet(SHEET);

  it("reads the Kiot code, store, Shopee SKU and the latest price of every row that has a SKU", () => {
    expect(records[0]).toEqual({ sku: "1BanhXe", kiotCode: "1BanhXe", store: "kho56", cost: 4150 });
    expect(records.find((r) => r.sku === "Quạt 10")).toEqual({ sku: "Quạt 10", kiotCode: "quat10", store: "khorem", cost: 109000 });
    expect(records.some((r) => r.kiotCode === "Xà_Đen_Thanh_Lý")).toBe(false);
    expect(records.filter((r) => r.sku === "")).toEqual([]);
  });

  it("keeps a row that has a SKU but no Kiot code or price", () => {
    expect(records.find((r) => r.sku === "Đổi_TypeC_ USB")).toEqual({ sku: "Đổi_TypeC_ USB", kiotCode: "", store: "", cost: null });
  });

  it("finds the price column whatever month its title names", () => {
    const next = parseKiotSheet(SHEET.replace("(t7)", "(t8)"));
    expect(next[0].cost).toBe(4150);
  });

  it("finds columns by title when others are added in front", () => {
    const csv = ["x,y,mã hàng kiot,kho kiot,sku shopee,Giá nhập MỚI NHẤT", "1,2,Kiot1,kho56,SKU1,2.500"].join("\n");
    expect(parseKiotSheet(csv)).toEqual([{ sku: "SKU1", kiotCode: "Kiot1", store: "kho56", cost: 2500 }]);
  });

  it("refuses a sheet without the SKU and Kiot columns", () => {
    expect(() => parseKiotSheet("a,b\n1,2")).toThrow(/sku shopee/);
  });
});

describe("KiotMap", () => {
  const map = new KiotMap(parseKiotSheet(SHEET));

  it("maps several Shopee SKUs to one Kiot product", () => {
    expect(map.resolve("Ví_Nâu_FORD")).toMatchObject({ kiotCode: "Vi_Nau", store: "kho56", cost: 11000 });
    expect(map.resolve("Ví_Nâu_MAZDA")).toMatchObject({ kiotCode: "Vi_Nau", cost: 11000 });
  });

  it("matches on letters and digits only, then without case and diacritics — nothing nearer", () => {
    expect(map.resolve("1 Banh Xe")).toMatchObject({ kiotCode: "1BanhXe" });
    expect(map.resolve("Quat_10")).toMatchObject({ kiotCode: "quat10" });
    expect(map.resolve("quạt 10")).toMatchObject({ kiotCode: "quat10" });
    expect(map.resolve("2BanhXe")).toBeNull();
  });

  it("has nothing for a SKU whose rows carry no Kiot code", () => {
    expect(map.resolve("Đổi_TypeC_ USB")).toBeNull();
  });

  it("takes the first row of a SKU listed twice and says the rows disagree", () => {
    expect(map.resolve("Khan_To_Ong")).toEqual({ sku: "Khan_To_Ong", kiotCode: "Khan_To_Ong", store: "kho56", cost: 9100, conflict: true });
    expect(map.resolve("1BanhXe")?.conflict).toBe(false);
  });
});

const item = (sku: string | undefined, quantity = 1) => ({ name: "n", variant: "v", quantity, ...(sku ? { sku } : {}) });
const page = (index: number, ...skus: (string | undefined)[]): WaybillPage => ({
  pageIndex: index,
  shopeeOrderId: `ORDER${index}`,
  trackingCode: null,
  declaredTotalQuantity: skus.length,
  items: skus.map((sku) => item(sku)),
});
const pageOf = (sku: string, quantity: number): WaybillPage => ({
  pageIndex: 0,
  shopeeOrderId: "ORDER0",
  trackingCode: null,
  declaredTotalQuantity: quantity,
  items: [item(sku, quantity)],
});

describe("parseComboSku", () => {
  it("splits a SKU written SKU*count+SKU*count into its base SKUs and counts", () => {
    expect(parseComboSku("1mOngBac100*4+dai110*2")).toEqual([
      { sku: "1mOngBac100", count: 4 },
      { sku: "dai110", count: 2 },
    ]);
  });

  it("counts a part with no * as one, and reads a lone SKU*count as a single part", () => {
    expect(parseComboSku("A*2+B")).toEqual([{ sku: "A", count: 2 }, { sku: "B", count: 1 }]);
    expect(parseComboSku("Moc_treo_S_Carbon*5")).toEqual([{ sku: "Moc_treo_S_Carbon", count: 5 }]);
  });

  it("trims spaces around parts and keeps the spaces inside a SKU", () => {
    expect(parseComboSku("Đế cài rèm (bộ)*2 + nước rửa kính 32ml + khăn vàng xám bé")).toEqual([
      { sku: "Đế cài rèm (bộ)", count: 2 },
      { sku: "nước rửa kính 32ml", count: 1 },
      { sku: "khăn vàng xám bé", count: 1 },
    ]);
  });

  it("is null for a plain SKU or one that isn't a clean list of parts", () => {
    expect(parseComboSku("1BanhXe")).toBeNull();
    expect(parseComboSku("uốn * phụ kiện")).toBeNull();
    expect(parseComboSku("A++B")).toBeNull();
    expect(parseComboSku("+A")).toBeNull();
    expect(parseComboSku("*3")).toBeNull();
    expect(parseComboSku("")).toBeNull();
  });

  it("does not take *0 for a count", () => {
    expect(parseComboSku("A*0+B")).toEqual([{ sku: "A*0", count: 1 }, { sku: "B", count: 1 }]);
  });
});

describe("applyKiotMap", () => {
  const map = new KiotMap(parseKiotSheet(SHEET));

  it("writes one Kiot line (code, store, quantity) onto each known item and lists the rest once", () => {
    const result = applyKiotMap([page(0, "1BanhXe", "Lạ1"), page(1, "Lạ1", undefined, "Quạt 10")], map);

    expect(result.pages[0].items[0].kiotLines).toEqual([
      { sku: "1BanhXe", quantity: 1, kiotCode: "1BanhXe", kiotStore: "kho56" },
    ]);
    expect(result.pages[0].items[1]).not.toHaveProperty("kiotLines");
    expect(result.pages[1].items[2].kiotLines).toEqual([
      { sku: "Quạt 10", quantity: 1, kiotCode: "quat10", kiotStore: "khorem" },
    ]);
    expect(result.missing).toEqual(["Lạ1"]);
  });

  it("takes the Kiot quantity from the line's quantity", () => {
    const result = applyKiotMap([pageOf("1BanhXe", 3)], map);
    expect(result.pages[0].items[0].kiotLines).toEqual([expect.objectContaining({ quantity: 3 })]);
    expect(result.pages[0].items[0].quantity).toBe(3);
  });

  it("splits a combined SKU into one Kiot line per base SKU, quantity × its count", () => {
    const result = applyKiotMap([pageOf("1mOngBac100*4+dai110*2", 3)], map);
    const [only] = result.pages[0].items;

    expect(only.sku).toBe("1mOngBac100*4+dai110*2");
    expect(only.quantity).toBe(3);
    expect(only.kiotLines).toEqual([
      { sku: "1mOngBac100", quantity: 12, kiotCode: "1mOngBac100", kiotStore: "kho56" },
      { sku: "dai110", quantity: 6, kiotCode: "dai110", kiotStore: "kho56" },
    ]);
    expect(result.missing).toEqual([]);
  });

  it("handles SKU*count for a single base SKU", () => {
    const result = applyKiotMap([pageOf("1mOngBac100*2", 5)], map);
    expect(result.pages[0].items[0].kiotLines).toEqual([
      { sku: "1mOngBac100", quantity: 10, kiotCode: "1mOngBac100", kiotStore: "kho56" },
    ]);
  });

  it("splits anyway when only some parts are in the sheet, naming the missing part and keeping its quantity", () => {
    const result = applyKiotMap([pageOf("1mOngBac100*2+senkoH200", 2)], map);
    expect(result.pages[0].items[0].kiotLines).toEqual([
      { sku: "1mOngBac100", quantity: 4, kiotCode: "1mOngBac100", kiotStore: "kho56" },
      { sku: "senkoH200", quantity: 2 },
    ]);
    expect(result.missing).toEqual(["senkoH200"]);
  });

  it("leaves a combined SKU alone when none of its parts is in the sheet", () => {
    const result = applyKiotMap([pageOf("Lạ1*2+Lạ2", 1)], map);
    expect(result.pages[0].items[0]).not.toHaveProperty("kiotLines");
    expect(result.missing).toEqual(["Lạ1*2+Lạ2"]);
  });

  it("prefers a row the sheet itself lists for the whole combined SKU", () => {
    const result = applyKiotMap([pageOf("Combo_A*2+Combo_B", 2)], map);
    expect(result.pages[0].items[0].kiotLines).toEqual([
      { sku: "Combo_A*2+Combo_B", quantity: 2, kiotCode: "Combo_AB", kiotStore: "kho56" },
    ]);
  });

  // The lookup key drops "*" and "+": "dinh*3" and "dinh3" share a key, but they are not the same product.
  it("does not take a plain SKU for a combined one that reads the same without its * and +", () => {
    const sheet = new KiotMap([
      { sku: "dinh", kiotCode: "KDINH", store: "kho56", cost: 100 },
      { sku: "dinh3", kiotCode: "KDINH3", store: "kho56", cost: 280 },
      { sku: "giaybac", kiotCode: "KGIAY", store: "kho56", cost: 50 },
    ]);
    const [alone] = applyKiotMap([pageOf("dinh*3", 2)], sheet).pages[0].items;
    expect(alone.kiotLines).toEqual([{ sku: "dinh", quantity: 6, kiotCode: "KDINH", kiotStore: "kho56" }]);

    // …while a SKU written without the operators still finds its own row.
    const [plain] = applyKiotMap([pageOf("dinh3", 2)], sheet).pages[0].items;
    expect(plain.kiotLines).toEqual([{ sku: "dinh3", quantity: 2, kiotCode: "KDINH3", kiotStore: "kho56" }]);

    // 2 orders of "3 nails + 2 foils" are 6 nails and 4 foils.
    const [combo] = applyKiotMap([pageOf("dinh*3+giaybac*2", 2)], sheet).pages[0].items;
    expect(combo.kiotLines?.map((l) => [l.sku, l.quantity])).toEqual([["dinh", 6], ["giaybac", 4]]);
  });

  it("never puts a price on a Kiot line, whatever the sheet says", () => {
    const [only] = applyKiotMap([page(0, "1BanhXe")], map).pages[0].items;
    expect(only.kiotLines).toEqual([{ sku: "1BanhXe", quantity: 1, kiotCode: "1BanhXe", kiotStore: "kho56" }]);
    expect(only.kiotLines?.[0]).not.toHaveProperty("cost");
  });

  it("reports SKUs the sheet lists with rows that disagree on code or store — also inside a combined SKU", () => {
    expect(applyKiotMap([page(0, "Khan_To_Ong")], map).conflicts).toEqual(["Khan_To_Ong"]);
    const inCombo = applyKiotMap([pageOf("Khan_To_Ong*2+NoPrice", 1)], map);
    expect(inCombo.conflicts).toEqual(["Khan_To_Ong"]);
  });

  it("does not call rows that differ only in price a conflict", () => {
    const sheet = new KiotMap([
      { sku: "B", kiotCode: "KB", store: "kho56", cost: 100 },
      { sku: "B", kiotCode: "KB", store: "kho56", cost: 200 },
    ]);
    expect(applyKiotMap([page(0, "B")], sheet).conflicts).toEqual([]);
  });

  it("leaves pages without SKUs exactly as they were", () => {
    const source = page(0, undefined);
    expect(applyKiotMap([source], map).pages[0]).toBe(source);
  });
});
