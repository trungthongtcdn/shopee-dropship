import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WaybillPage } from "@/lib/waybill/items";
import { applySkuMap, SkuCatalog, type SkuSnapshot, type SkuStore } from "@/lib/waybill/skuCatalog";
import { SkuMap, toSkuRecords } from "@/lib/waybill/skuMap";

const page = (index: number, ...skus: (string | undefined)[]): WaybillPage => ({
  pageIndex: index,
  shopeeOrderId: `ORDER${index}`,
  trackingCode: null,
  declaredTotalQuantity: skus.length,
  items: skus.map((sku, i) => ({ name: `item ${i}`, variant: "", quantity: 1, sku })),
});

const skusOf = (pages: WaybillPage[]) => pages.flatMap((p) => p.items.map((i) => i.sku));
const csv = (...skus: string[]) => ["STT,SKU,ghi chú", ...skus.map((s) => `,${s},`)].join("\n");

class MemoryStore implements SkuStore {
  saved: SkuSnapshot | null;
  saves = 0;
  constructor(initial: SkuSnapshot | null = null) {
    this.saved = initial;
  }
  async load() {
    return this.saved;
  }
  async save(snapshot: SkuSnapshot) {
    this.saved = snapshot;
    this.saves += 1;
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
let clock = 0;
const now = () => clock;

beforeEach(() => {
  clock = Date.parse("2026-10-12T08:00:00Z");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("applySkuMap", () => {
  const map = new SkuMap(toSkuRecords(["TyHoi_D160_Den", "ConThu"]));

  it("swaps known SKUs and reports the unknown ones once each", () => {
    const result = applySkuMap([page(0, "TyHoiD160Den", "Lạ1"), page(1, "ConThu", "Lạ1", undefined)], map);
    expect(skusOf(result.pages)).toEqual(["TyHoi_D160_Den", "Lạ1", "ConThu", "Lạ1", undefined]);
    expect(result.unmatched).toEqual(["Lạ1"]);
  });

  it("leaves everything else on the page as it was", () => {
    const source = page(0, "TyHoiD160Den");
    const [mapped] = applySkuMap([source], map).pages;
    expect(mapped).toEqual({ ...source, items: [{ ...source.items[0], sku: "TyHoi_D160_Den" }] });
    expect(source.items[0].sku).toBe("TyHoiD160Den");
  });
});

describe("SkuCatalog", () => {
  it("fetches the sheet on first use, keeps it, and doesn't fetch again within the day", async () => {
    const store = new MemoryStore();
    const fetchCsv = vi.fn(async () => csv("TyHoi_D160_Den", "ConThu"));
    const catalog = new SkuCatalog(store, { now, fetchCsv });

    const first = await catalog.mapPages([page(0, "TyHoiD160Den")]);
    expect(skusOf(first.pages)).toEqual(["TyHoi_D160_Den"]);
    expect(first.notices).toEqual([]);
    expect(store.saved?.records.map((r) => r.sku)).toEqual(["TyHoi_D160_Den", "ConThu"]);

    clock += 23 * HOUR;
    await catalog.mapPages([page(0, "ConThu")]);
    expect(fetchCsv).toHaveBeenCalledTimes(1);
  });

  it("fetches again once the copy is a day old", async () => {
    const fetchCsv = vi.fn(async () => csv("A_1"));
    const catalog = new SkuCatalog(new MemoryStore(), { now, fetchCsv });
    await catalog.mapPages([page(0, "A1")]);
    clock += 25 * HOUR;
    await catalog.mapPages([page(0, "A1")]);
    expect(fetchCsv).toHaveBeenCalledTimes(2);
  });

  it("uses the stored copy after a restart without fetching", async () => {
    const store = new MemoryStore({ syncedAt: new Date(clock - HOUR), records: toSkuRecords(["Kept_1"]) });
    const fetchCsv = vi.fn(async () => csv("Other"));
    const catalog = new SkuCatalog(store, { now, fetchCsv });
    expect(skusOf((await catalog.mapPages([page(0, "Kept1")])).pages)).toEqual(["Kept_1"]);
    expect(fetchCsv).not.toHaveBeenCalled();
  });

  it("looks again, once, when a SKU isn't in the copy — it may have been added today", async () => {
    let sheet = csv("Old_1");
    const fetchCsv = vi.fn(async () => sheet);
    const catalog = new SkuCatalog(new MemoryStore(), { now, fetchCsv });
    await catalog.mapPages([page(0, "Old1")]);
    expect(fetchCsv).toHaveBeenCalledTimes(1);

    sheet = csv("Old_1", "New_2");
    clock += 30 * MINUTE;
    const result = await catalog.mapPages([page(0, "New2")]);
    expect(skusOf(result.pages)).toEqual(["New_2"]);
    expect(fetchCsv).toHaveBeenCalledTimes(2);

    // a SKU that is in no sheet doesn't make every request fetch
    await catalog.mapPages([page(0, "Nowhere")]);
    await catalog.mapPages([page(0, "Nowhere")]);
    clock += 5 * MINUTE;
    await catalog.mapPages([page(0, "Nowhere")]);
    expect(fetchCsv).toHaveBeenCalledTimes(2);
    clock += 6 * MINUTE;
    await catalog.mapPages([page(0, "Nowhere")]);
    expect(fetchCsv).toHaveBeenCalledTimes(3);
  });

  it("does not touch the sheet for pages that have no SKU at all", async () => {
    const fetchCsv = vi.fn(async () => csv("A_1"));
    const catalog = new SkuCatalog(new MemoryStore(), { now, fetchCsv });
    const pages = [page(0, undefined, undefined)];
    expect(await catalog.mapPages(pages)).toEqual({ pages, notices: [] });
    expect(fetchCsv).not.toHaveBeenCalled();
  });

  it("lists the SKUs it could not find, and keeps them as they were read", async () => {
    const catalog = new SkuCatalog(new MemoryStore(), { now, fetchCsv: async () => csv("A_1") });
    const result = await catalog.mapPages([page(0, "A1", "Lạ_1", "Lạ_2")]);
    expect(skusOf(result.pages)).toEqual(["A_1", "Lạ_1", "Lạ_2"]);
    expect(result.notices).toEqual(["2 SKU không có trong danh sách SKU, giữ nguyên như đọc từ phiếu: Lạ_1, Lạ_2."]);
  });

  it("shortens a long list of unknown SKUs", async () => {
    const catalog = new SkuCatalog(new MemoryStore(), { now, fetchCsv: async () => csv("A_1") });
    const unknown = Array.from({ length: 8 }, (_, i) => `X${i}`);
    const { notices } = await catalog.mapPages([page(0, ...unknown)]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("8 SKU không có trong danh sách SKU");
    expect(notices[0]).toContain("X0, X1, X2, X3, X4 và 3 SKU khác");
  });

  it("keeps working from the old copy when the sheet can't be fetched, and says how old it is", async () => {
    const store = new MemoryStore();
    let fail = false;
    const catalog = new SkuCatalog(store, {
      now,
      fetchCsv: async () => {
        if (fail) throw new Error("network down");
        return csv("A_1");
      },
    });
    await catalog.mapPages([page(0, "A1")]);
    fail = true;
    clock += 26 * HOUR;
    const result = await catalog.mapPages([page(0, "A1")]);
    expect(skusOf(result.pages)).toEqual(["A_1"]);
    expect(result.notices).toEqual([expect.stringContaining("Danh sách SKU chưa được cập nhật từ")]);
  });

  it("passes the pages through, with a notice, when there has never been a list", async () => {
    const catalog = new SkuCatalog(new MemoryStore(), {
      now,
      fetchCsv: async () => {
        throw new Error("403");
      },
    });
    const pages = [page(0, "A1")];
    const result = await catalog.mapPages(pages);
    expect(result.pages).toBe(pages);
    expect(result.notices).toEqual(["Không tải được danh sách SKU — SKU giữ nguyên như đọc từ phiếu."]);
  });

  it("does not copy over a good list a sheet that came back nearly empty", async () => {
    const many = Array.from({ length: 10 }, (_, i) => `SKU_${i}`);
    let sheet = csv(...many);
    const catalog = new SkuCatalog(new MemoryStore(), { now, fetchCsv: async () => sheet });
    await catalog.mapPages([page(0, "SKU0")]);

    sheet = csv("SKU_0");
    clock += 25 * HOUR;
    const result = await catalog.mapPages([page(0, "SKU5")]);
    expect(skusOf(result.pages)).toEqual(["SKU_5"]);
  });

  it("shares one fetch between requests that arrive together", async () => {
    let release: (text: string) => void = () => {};
    const fetchCsv = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const catalog = new SkuCatalog(new MemoryStore(), { now, fetchCsv });
    const both = Promise.all([catalog.mapPages([page(0, "A1")]), catalog.mapPages([page(1, "A1")])]);
    await vi.waitFor(() => expect(fetchCsv).toHaveBeenCalled());
    release(csv("A_1"));
    const [one, two] = await both;
    expect(fetchCsv).toHaveBeenCalledTimes(1);
    expect(skusOf(one.pages)).toEqual(["A_1"]);
    expect(skusOf(two.pages)).toEqual(["A_1"]);
  });

  it("still maps when the copy can't be stored", async () => {
    const store = new MemoryStore();
    store.save = async () => {
      throw new Error("disk full");
    };
    const catalog = new SkuCatalog(store, { now, fetchCsv: async () => csv("A_1") });
    expect(skusOf((await catalog.mapPages([page(0, "A1")])).pages)).toEqual(["A_1"]);
  });
});
