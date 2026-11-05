import { describe, it, expect } from "vitest";
import type { WaybillPage } from "@/lib/waybill/items";
import { applyKiotMap, KiotMap, parseKiotSheet } from "@/lib/waybill/kiotMap";

// The real "GIÁ FULL" tab keeps one "kho gửi" column per shop right after the price column;
// a second, empty block of the same titles sits further right, after the older prices.
const SHEET = [
  "STT,mã hàng kiot,kho kiot,sku shopee,ghi chú,đơn vị TÍNH,Giá nhập MỚI NHẤT (t7),THE THAO,FASTFIX,QUATUNI,Giá nhập T6,,THE THAO,FASTFIX,QUATUNI",
  ",1BanhXe,kho56,1BanhXe,,,4.150,khoLuan,khoLuan,khoLuan,4.650,,,,",
  ",ChanGheXoay,kho56,ChanGheXoay,,,77.500,khouni,khouni,khoLuan,82.300,,,,",
  ",Bo_02BanhXe,kho56,Bo_02BanhXe,,,8.250,khoLuan,,khoLuan,,,,,",
  ",NoShops,kho56,NoShops,,,1.000,,,,,,,,",
].join("\n");

const page = (shopName: string | undefined, sku: string, extra: Partial<WaybillPage> = {}): WaybillPage => ({
  pageIndex: 0,
  shopeeOrderId: "O1",
  trackingCode: "SPXVN1",
  declaredTotalQuantity: 1,
  items: [{ name: "x", variant: "", quantity: 1, sku }],
  ...(shopName ? { shopName } : {}),
  ...extra,
});

describe("parseKiotSheet: kho gửi per shop", () => {
  const records = parseKiotSheet(SHEET);

  it("reads the kho gửi of each shop from the columns after the price, up to the next price column", () => {
    expect(records.find((r) => r.sku === "ChanGheXoay")?.deliveries).toEqual({ thethao: "khouni", fastfix: "khouni", quatuni: "khoLuan" });
  });

  it("leaves out a shop whose cell is empty, and has no deliveries at all when every cell is", () => {
    expect(records.find((r) => r.sku === "Bo_02BanhXe")?.deliveries).toEqual({ thethao: "khoLuan", quatuni: "khoLuan" });
    expect(records.find((r) => r.sku === "NoShops")?.deliveries).toBeUndefined();
  });

  it("does not read the second block of shop titles", () => {
    expect(Object.keys(records[0].deliveries ?? {})).toEqual(["thethao", "fastfix", "quatuni"]);
  });

  it("reads no deliveries from a sheet without shop columns", () => {
    const [record] = parseKiotSheet(",mã hàng kiot,kho kiot,sku shopee,Giá nhập MỚI NHẤT (t7)\n,A,kho56,A,1.000");
    expect(record.deliveries).toBeUndefined();
  });
});

describe("KiotMap.shopColumnFor", () => {
  const map = new KiotMap(parseKiotSheet(SHEET));

  it("finds the column whose title the label's shop name contains, whatever the case, spaces and marks", () => {
    expect(map.shopColumnFor("FASTFIX.VN")).toBe("fastfix");
    expect(map.shopColumnFor("Kho Sỉ Đồ Thể Thao")).toBe("thethao");
    expect(map.shopColumnFor("quatuni")).toBe("quatuni");
  });

  it("knows the shop name printed for QUATUNI", () => {
    expect(map.shopColumnFor("Kho Quạt Thông Gió LCN")).toBe("quatuni");
  });

  it("is null for a shop that matches no column, and for no name", () => {
    expect(map.shopColumnFor("Shop Lạ")).toBeNull();
    expect(map.shopColumnFor("")).toBeNull();
  });

  it("lists the kho the sheet gives, khoLuan first", () => {
    expect(map.khoOptions()).toEqual(["khoLuan", "khouni"]);
  });
});

describe("applyKiotMap: kho gửi of each Kiot line", () => {
  const map = new KiotMap(parseKiotSheet(SHEET));

  it("takes the SKU's kho gửi for the shop that sends the parcel", () => {
    const applied = applyKiotMap([page("FASTFIX.VN", "ChanGheXoay"), page("Kho Quạt Thông Gió LCN", "ChanGheXoay")], map);
    expect(applied.pages.map((p) => p.items[0].kiotLines?.[0].khoGiao)).toEqual(["khouni", "khoLuan"]);
  });

  it("gives each part of a combined SKU its own kho gửi", () => {
    const applied = applyKiotMap([page("FASTFIX.VN", "ChanGheXoay*2+1BanhXe")], map);
    expect(applied.pages[0].items[0].kiotLines?.map((line) => [line.sku, line.khoGiao])).toEqual([
      ["ChanGheXoay", "khouni"],
      ["1BanhXe", "khoLuan"],
    ]);
  });

  it("gives no kho gửi where the sheet's cell for that shop is empty", () => {
    const applied = applyKiotMap([page("FASTFIX.VN", "Bo_02BanhXe")], map);
    expect(applied.pages[0].items[0].kiotLines?.[0]).not.toHaveProperty("khoGiao");
  });

  it("gives a shop that matches no column the kho all the columns agree on, and does not name it", () => {
    const applied = applyKiotMap([page("Shop Lạ", "1BanhXe")], map);
    expect(applied.pages[0].items[0].kiotLines?.[0].khoGiao).toBe("khoLuan");
    expect(applied.unknownShops).toEqual([]);
  });

  it("names a shop that matches no column, once, and leaves its kho gửi empty, where the columns disagree", () => {
    const applied = applyKiotMap([page("Shop Lạ", "ChanGheXoay"), page("Shop Lạ", "ChanGheXoay", { shopeeOrderId: "O2" })], map);
    expect(applied.unknownShops).toEqual(["Shop Lạ"]);
    expect(applied.pages[0].items[0].kiotLines?.[0]).not.toHaveProperty("khoGiao");
  });

  it("leaves a label with no sender name to the columns' agreement too", () => {
    const applied = applyKiotMap([page(undefined, "1BanhXe"), page(undefined, "ChanGheXoay", { shopeeOrderId: "O2" })], map);
    expect(applied.pages.map((p) => p.items[0].kiotLines?.[0].khoGiao)).toEqual(["khoLuan", undefined]);
    expect(applied.unknownShops).toEqual([]);
  });

  it("does not name a shop for a SKU with no kho at all", () => {
    expect(applyKiotMap([page("Shop Lạ", "NoShops")], map).unknownShops).toEqual([]);
  });

  it("does not report shops when the sheet has no shop columns", () => {
    const bare = new KiotMap(parseKiotSheet(",mã hàng kiot,kho kiot,sku shopee,Giá nhập MỚI NHẤT (t7)\n,A,kho56,A,1.000"));
    expect(applyKiotMap([page("Shop Lạ", "A")], bare).unknownShops).toEqual([]);
  });
});
