import { describe, it, expect } from "vitest";
import { loadScripts, makeSheet } from "../helpers/appsScript";
import {
  ORDER_HEADERS,
  PRODUCT_HEADERS,
  PRICING_HEADERS,
  PAYMENT_HEADERS,
  TAB,
  bannerGrid,
  headerOnTopGrid,
  fullWorkbook,
  orderLine,
  product,
  PADDING_PRODUCT_ROW,
} from "../helpers/shop2Fixtures";
import { syncPayloadSchema, parseIncomingRows } from "@/lib/sync/validatePayload";

describe("Sync.shop2.gs", () => {
  it("pushes the four tabs under the payload names the webhook accepts, with the shop secret", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook() });

    script.run("syncAllTabs()");

    expect(script.calls.map((call) => call.body.tab).sort()).toEqual(["cancelled", "orders", "products", "returned_refunded"]);
    expect(script.calls.every((call) => call.secret === "shop2-secret")).toBe(true);
    expect(script.calls.every((call) => call.url === "https://app.test/api/sync/webhook")).toBe(true);
  });

  it("sends each row keyed by its header text, with the real sheet row number", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook({ orders: [orderLine(), orderLine({ "Mã đơn hàng": "261012B45709WX", "Tên phân loại hàng": "D100" })] }) });

    script.run("syncAllTabs()");

    const [first, second] = script.callFor("orders")[0].body.rows;
    expect(first.rowIndex).toBe(3);
    expect(second.rowIndex).toBe(4);
    expect(first.data["Mã đơn hàng"]).toBe("261011A43HB9Y0");
    expect(first.data["Tên phân loại hàng"]).toBe("D160");
    expect(first.data["Trạng Thái Đơn Hàng"]).toBe("Đã giao");
    expect(first.data["Mã vận đơn"]).toBe("SPXVN0687202");
    expect(first.data["Số lượng"]).toBe(1);
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.hash).not.toBe(second.hash);
  });

  it("matches columns by header name, not position", () => {
    const reversed = [...ORDER_HEADERS].reverse();
    const sheets = fullWorkbook();
    sheets[0] = makeSheet(TAB.orders, bannerGrid(reversed, [orderLine()]));
    const script = loadScripts(["Sync.shop2.gs"], { sheets });

    script.run("syncAllTabs()");

    const [row] = script.callFor("orders")[0].body.rows;
    expect(row.data["Mã đơn hàng"]).toBe("261011A43HB9Y0");
    expect(row.data["Tên phân loại hàng"]).toBe("D160");
  });

  it("finds the cancellation tab although its real name ends with a space", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook() });

    script.run("syncAllTabs()");

    const [row] = script.callFor("cancelled")[0].body.rows;
    expect(row.data["Mã đơn hàng"]).toBe("261012EMH5BFWD");
    expect(row.data["Lý do hủy"]).toBe("Hủy bởi người mua");
  });

  it("reads the product list from header row 1 and drops the padding rows that have no SKU", () => {
    const padding = Array.from({ length: 5 }, () => PADDING_PRODUCT_ROW);
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook({ products: [product(), ...padding, product({ "MII - Mã phân loại": "311565665779", "Tên phân loại": "40 vít HH+ Tua vít" })] }) });

    script.run("syncAllTabs()");

    const rows = script.callFor("products")[0].body.rows;
    expect(rows.map((row) => row.data["MII - Mã phân loại"])).toEqual(["326567746540", "311565665779"]);
    // Sheet row numbers survive the filtering: header row 1, first product row 2, last row 8.
    expect(rows.map((row) => row.rowIndex)).toEqual([2, 8]);
    expect(rows[0].data["Giá nhập chưa VAT"]).toBe(63000);
  });

  it("drops cancellation rows that have no order id", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook({ cancelled: [orderLine({ "Mã đơn hàng": "261012EMH5BFWD" }), orderLine({ "Mã đơn hàng": "" })] }) });

    script.run("syncAllTabs()");

    expect(script.callFor("cancelled")[0].body.rows).toHaveLength(1);
  });

  it("turns text dates into ISO instants in Vietnam time, so the server's own timezone does not shift them", () => {
    const script = loadScripts(["Sync.shop2.gs"], {
      sheets: fullWorkbook({ orders: [orderLine({ "Ngày đặt hàng": "2026-10-10 23:13", "Ngày hủy thành công": "2026-10-10 0:00", "Ngày giao hàng dự kiến": "2026-10-12" })] }),
    });

    script.run("syncAllTabs()");

    const [row] = script.callFor("orders")[0].body.rows;
    expect(row.data["Ngày đặt hàng"]).toBe("2026-10-10T23:13:00+07:00");
    expect(row.data["Ngày hủy thành công"]).toBe("2026-10-10T00:00:00+07:00");
    expect(row.data["Ngày giao hàng dự kiến"]).toBe("2026-10-12T00:00:00+07:00");
    expect(new Date(row.data["Ngày đặt hàng"] as string).toISOString()).toBe("2026-10-10T16:13:00.000Z");
    // Not a date: untouched.
    expect(row.data["Mã Kiện Hàng"]).toBe("6070130455008");
  });

  it("maps the returns tab's own column names onto the ones the server reads", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook() });

    script.run("syncAllTabs()");

    const [row] = script.callFor("returned_refunded")[0].body.rows;
    expect(row.data["Tên kho hàng"]).toBe("WH329");
    expect(row.data["NCC note"]).toBe("đã liên hệ");
    expect(row.data["Phân loại hàng"]).toBe("40 vít HH+ Tua vít");
  });

  it("takes the first filled value when a header appears twice (the returns tab has two 'NCC ghi chú')", () => {
    const sheets = fullWorkbook({ returns: [{ "Mã đơn hàng": "261012F37NYFXM" }] });
    // Fill only the second, trailing-space copy of the column (the last one).
    const grid = bannerGrid(
      ["NCC ghi chú", "Mã đơn hàng", "NCC ghi chú "],
      [{ "Mã đơn hàng": "261012F37NYFXM", "NCC ghi chú ": "ghi chú cột sau" }]
    );
    sheets[2] = makeSheet(TAB.returns, grid);
    const script = loadScripts(["Sync.shop2.gs"], { sheets });

    script.run("syncAllTabs()");

    const [row] = script.callFor("returned_refunded")[0].body.rows;
    expect(row.data["NCC note"]).toBe("ghi chú cột sau");
  });

  it("does not push a tab whose required header is missing, records why, and still pushes the others", () => {
    const sheets = fullWorkbook();
    sheets[0] = makeSheet(TAB.orders, bannerGrid(ORDER_HEADERS.filter((header) => header !== "Tên phân loại hàng"), [orderLine()]));
    const script = loadScripts(["Sync.shop2.gs"], { sheets });

    script.run("syncAllTabs()");

    expect(script.callFor("orders")).toHaveLength(0);
    expect(script.calls.map((call) => call.body.tab).sort()).toEqual(["cancelled", "products", "returned_refunded"]);
    expect(script.props.last_error).toContain("Tên phân loại hàng");
    expect(script.props.last_error).toContain(TAB.orders);
    expect(script.logs.some((line) => line.startsWith("ERROR") && line.includes("Tên phân loại hàng"))).toBe(true);
  });

  it("never pushes a tab whose sheet is missing (an empty payload would soft-delete everything)", () => {
    const sheets = fullWorkbook().filter((sheet) => sheet.getName() !== TAB.orders);
    const script = loadScripts(["Sync.shop2.gs"], { sheets });

    script.run("syncAllTabs()");

    expect(script.callFor("orders")).toHaveLength(0);
    expect(script.props.last_error).toContain(TAB.orders);
  });

  it("warns about a missing optional header but still pushes the tab", () => {
    const sheets = fullWorkbook();
    sheets[0] = makeSheet(TAB.orders, bannerGrid(ORDER_HEADERS.filter((header) => header !== "Ngày giao hàng dự kiến"), [orderLine()]));
    const script = loadScripts(["Sync.shop2.gs"], { sheets });

    script.run("syncAllTabs()");

    expect(script.callFor("orders")).toHaveLength(1);
    expect(script.logs.some((line) => line.startsWith("WARNING") && line.includes("Ngày giao hàng dự kiến"))).toBe(true);
  });

  it("pushes an empty payload for a tab that has its headers but no data rows yet", () => {
    const sheets = fullWorkbook({ cancelled: [] });
    const script = loadScripts(["Sync.shop2.gs"], { sheets });

    script.run("syncAllTabs()");

    expect(script.callFor("cancelled")[0].body.rows).toEqual([]);
  });

  it("builds payloads the webhook's own validation accepts", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook() });

    script.run("syncAllTabs()");

    for (const call of script.calls) {
      const body = syncPayloadSchema.parse(call.body);
      const { validRows, errors } = parseIncomingRows(body.rows);
      expect(errors).toEqual([]);
      expect(validRows).toHaveLength(body.rows.length);
    }
  });

  it("records an HTTP failure (wrong secret) instead of silently looking healthy", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook(), statuses: [401] });

    script.run("syncAllTabs()");

    expect(script.props.last_error).toContain("HTTP 401");
    // A 4xx is not retried: one call per tab.
    expect(script.calls).toHaveLength(4);
  });

  it("does not call out when the webhook URL or secret is not set", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook(), props: { SYNC_SECRET: "" } });

    script.run("syncAllTabs()");

    expect(script.calls).toHaveLength(0);
    expect(script.props.last_error).toContain("SYNC_SECRET");
  });

  it("installs a 10 minute trigger on syncAllTabs", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook() });

    script.run("createTimeTrigger()");

    expect(script.triggers).toEqual([{ handler: "syncAllTabs", everyMinutes: 10 }]);
  });

  it("manualTestAllTabs logs row counts and pushes nothing", () => {
    const script = loadScripts(["Sync.shop2.gs"], { sheets: fullWorkbook() });

    script.run("manualTestAllTabs()");

    expect(script.calls).toHaveLength(0);
    expect(script.logs.join("\n")).toContain("orders");
    expect(script.logs.join("\n")).toContain("1 rows");
  });
});

describe("PricingSync.shop2.gs", () => {
  const PRICING_SHEET = "1.Top Thông tin hàng hoá";

  function pricingGrid(rows: unknown[][]) {
    return [PRICING_HEADERS, ...rows];
  }

  it("posts sku_pricing rows from '1.Top Thông tin hàng hoá'", () => {
    const sheet = makeSheet(PRICING_SHEET, pricingGrid([["1", "336567768206", "Móc", "Bộ Móc A Mazda", "moc5quai1lop", 28000, 27300]]));
    const script = loadScripts(["PricingSync.shop2.gs"], { sheets: [sheet] });

    script.run("syncPricing()");

    expect(script.calls).toHaveLength(1);
    const [call] = script.calls;
    expect(call.body.tab).toBe("sku_pricing");
    expect(call.secret).toBe("shop2-secret");
    expect(call.body.rows[0].rowIndex).toBe(2);
    expect(call.body.rows[0].data["MÃ PHÂN LOẠI (SKU)"]).toBe("336567768206");
    expect(call.body.rows[0].data["MÃ KIOT"]).toBe("moc5quai1lop");
  });

  it("keeps the price when a later duplicate header column is empty", () => {
    const sheet = makeSheet(PRICING_SHEET, pricingGrid([["1", "336567768206", "Móc", "Bộ Móc A Mazda", "moc5quai1lop", 28000, 27300, "", "", "", "", ""]]));
    const script = loadScripts(["PricingSync.shop2.gs"], { sheets: [sheet] });

    script.run("syncPricing()");

    expect(script.calls[0].body.rows[0].data["GIÁ CẦN THU VỀ"]).toBe(27300);
  });

  it("takes the later duplicate column when the first is empty", () => {
    const sheet = makeSheet(PRICING_SHEET, pricingGrid([["1", "336567768206", "Móc", "Bộ Móc A Mazda", "moc5quai1lop", "", "", "", "", 30000, 29250, ""]]));
    const script = loadScripts(["PricingSync.shop2.gs"], { sheets: [sheet] });

    script.run("syncPricing()");

    expect(script.calls[0].body.rows[0].data["GIÁ CẦN THU VỀ"]).toBe(29250);
  });

  it("skips rows with no SKU", () => {
    const sheet = makeSheet(
      PRICING_SHEET,
      pricingGrid([
        ["1", "336567768206", "Móc", "Bộ Móc A Mazda", "moc5quai1lop", 28000, 27300],
        ["72", "", "", "", "", "", ""],
      ])
    );
    const script = loadScripts(["PricingSync.shop2.gs"], { sheets: [sheet] });

    script.run("syncPricing()");

    expect(script.calls[0].body.rows).toHaveLength(1);
  });

  it("does not push when a header the server reads is missing, and records it", () => {
    const grid = [PRICING_HEADERS.map((header) => (header === "MÃ KIOT" ? "MÃ KIOT MỚI" : header)), ["1", "336567768206", "Móc", "Bộ Móc A Mazda", "moc5quai1lop", 28000, 27300]];
    const script = loadScripts(["PricingSync.shop2.gs"], { sheets: [makeSheet(PRICING_SHEET, grid)] });

    script.run("syncPricing()");

    expect(script.calls).toHaveLength(0);
    expect(script.props.last_error).toContain("MÃ KIOT");
  });

  it("does not push when the tab is missing", () => {
    const script = loadScripts(["PricingSync.shop2.gs"], { sheets: [] });

    script.run("syncPricing()");

    expect(script.calls).toHaveLength(0);
    expect(script.props.last_error).toContain(PRICING_SHEET);
  });

  it("installs a 30 minute trigger", () => {
    const script = loadScripts(["PricingSync.shop2.gs"], { sheets: [] });

    script.run("createPricingTimeTrigger()");

    expect(script.triggers).toEqual([{ handler: "syncPricing", everyMinutes: 30 }]);
  });
});

// Shop 2's payment file has the same layout as shop 1's, so PaymentSync.gs is used
// as it is. These pin that down against the shop 2 file's real tabs.
describe("PaymentSync.gs against the shop 2 payment file", () => {
  const PAYMENT_URL = "https://docs.google.com/spreadsheets/d/payment-file/edit";

  function paymentBanner() {
    return [["CÔNG TY TNHH S-RETAIL VN"], ["MST"], ["Địa chỉ"], ["BẢNG KÊ SỐ TIỀN THANH TOÁN"], ["(Tính trên Số lượng đơn hàng thành công từ ngày 12/10/2026 đến ngày 18/10/2026)"], ["VN_VŨ THỊ THẢO TRANG_MII"], ["", "", "", "", "Tổng cộng thành tiền phải thanh toán"]];
  }

  function paymentSheets() {
    const week = makeSheet("12/10/2026-18/10/2026", [
      ...paymentBanner(),
      PAYMENT_HEADERS,
      ["01/10/2026", "12/10/2026-18/10/2026", "261013H6RD7Y", "54918639571_311565665779", "Hộp", "NCC", "310812293272", 1, 62876, 25276, 943.14, 36656.86],
      ["01/10/2026", "12/10/2026-18/10/2026", "261013H6RD7Y", "54918639571_311565665779", "Hộp", "NCC", "310812293272", 1, 62876, 25276, 943.14, 100],
      ["01/10/2026", "12/10/2026-18/10/2026", "261015M9TWX1", "56668624957_311565665780", "Hộp", "NCC", "310812293272", 1, 120320, 60160, 1804.8, 58355.2],
    ]);
    const emptyWeek = makeSheet("01/05/2026-03/05/2026", [...paymentBanner(), PAYMENT_HEADERS]);
    const invoices = makeSheet("Xuất hóa đơn", [
      ["Mã đơn hàng", "Ngày đặt hàng", "Lý do hủy", "Trạng thái Trả hàng/Hoàn tiền", "Tên sản phẩm", "Tên kho hàng", "Tên phân loại hàng", "Giá ưu đãi", "Số lượng", "Tổng số tiền Người mua thanh toán"],
    ]);
    return [week, emptyWeek, invoices];
  }

  it("aggregates per (order, model id) and ignores the invoice and empty tabs", () => {
    const script = loadScripts(["PaymentSync.gs"], { external: { [PAYMENT_URL]: paymentSheets() }, props: { PAYMENT_SHEET_URL: PAYMENT_URL } });

    script.run("syncPayment()");

    const [call] = script.calls;
    expect(call.body.tab).toBe("payment");
    const byKey = Object.fromEntries(call.body.rows.map((row) => [`${row.data["Mã đơn hàng"]}/${row.data["Mã sản phẩm"]}`, row.data]));
    // "itemId_modelId" -> the model id, which is the SKU in the mapping sheet.
    expect(Object.keys(byKey).sort()).toEqual(["261013H6RD7Y/311565665779", "261015M9TWX1/311565665780"]);
    expect(byKey["261013H6RD7Y/311565665779"]["Giá trị còn lại"]).toBeCloseTo(36756.86, 2);
    expect(String(byKey["261013H6RD7Y/311565665779"]["Ngày thanh toán"])).toMatch(/^2026-10-1[78]T/);
  });

  it("sends one batch for the week that has data, labelled with the tab name", () => {
    const script = loadScripts(["PaymentSync.gs"], { external: { [PAYMENT_URL]: paymentSheets() }, props: { PAYMENT_SHEET_URL: PAYMENT_URL } });

    script.run("syncPaymentBatches()");

    expect(script.calls).toHaveLength(1);
    expect(script.calls[0].body.tab).toBe("payment_batch");
    expect(script.calls[0].body.batchLabel).toBe("12/10/2026-18/10/2026");
    expect(script.calls[0].body.rows).toHaveLength(3);
  });
});

// Keeps the fixtures honest: the product tab layout the script is built for.
describe("shop 2 fixtures", () => {
  it("use the headers the server's product mapping reads", () => {
    for (const header of ["MII - Mã phân loại", "MII - Mã sản phẩm", "Tên sản phẩm", "Tên phân loại", "Giá nhập chưa VAT"]) {
      expect(PRODUCT_HEADERS).toContain(header);
    }
    expect(headerOnTopGrid(PRODUCT_HEADERS, [product()])).toHaveLength(2);
  });
});
