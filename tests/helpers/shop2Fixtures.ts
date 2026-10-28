import { makeSheet, type Grid } from "./appsScript";

// Header rows copied from the live shop 2 workbook "VN_VŨ THỊ THẢO TRANG_MII"
// (read 2026-10-28). Data rows are made up.

export const ORDER_HEADERS = [
  "NCC ghi chú",
  "Mã đơn hàng",
  "Mã Kiện Hàng",
  "Ngày đặt hàng",
  "Trạng Thái Đơn Hàng",
  "Lý do hủy",
  "Mã vận đơn",
  "Đơn Vị Vận Chuyển",
  "Phương thức giao hàng",
  "Ngày giao hàng dự kiến",
  "Thời gian giao hàng",
  "Ngày hủy thành công",
  "Tên sản phẩm",
  "Tên kho hàng",
  "Tên phân loại hàng",
  "Số lượng",
  "Thời gian hoàn thành đơn hàng",
  "SKU phân loại hàng",
  "Giá ưu đãi",
  "Tổng số tiền Người mua thanh toán",
];

export const CANCELLED_HEADERS = [...ORDER_HEADERS, "Check Dup", "NCC ghi chú "];

export const RETURN_HEADERS = [
  "NCC ghi chú",
  "Kho hàng",
  "Mã số khiếu nại",
  "Mã đơn hàng",
  "Ngày đặt hàng",
  "Người Mua",
  "Tên sản phẩm",
  "Phân loại hàng",
  "Đơn Giá",
  "Thời gian khiếu nại",
  "Trạng thái Trả hàng/Hoàn tiền",
  "Trả hàng/Hoàn tiền toàn bộ Đơn Hàng?",
  "Số lượng Hoàn",
  "Phương án",
  "Lí do Trả hàng/Hoàn tiền",
  "Ghi chú của Người mua khi trả hàng",
  "Tổng số tiền Hoàn trả",
  "Thời gian hoàn tiền",
  "Đơn vị vận chuyển trả hàng",
  "Mã vận đơn trả hàng",
  "Trạng thái trả hàng",
  "Thời gian hoàn trả hàng thành công",
  "Người Bán cần phản hồi trước",
  "Lí Do Khiếu Nại",
  "Đơn vị vận chuyển giao hàng",
  "Mã vận đơn giao hàng",
  "Tổng Giá Trị",
  "Trạng thái xử lý khiếu nại",
  "Check Dup",
  "NCC ghi chú ",
];

export const PRODUCT_HEADERS = [
  "Vendor ID",
  "Vendor Name",
  "Warehouse",
  "MII - MT",
  "MII - MP",
  "MII - Mã sản phẩm",
  "MII - Mã phân loại",
  "Tên sản phẩm",
  "Tên phân loại",
  "Giá nhập chưa VAT",
  "Giá nhập có VAT",
  "% VAT",
  "Tình trạng sản phẩm",
  "Link sản phẩm",
];

// The pricing workbook "Top dữ liệu luân up" — note GIÁ CẦN THU VỀ twice (G and K).
export const PRICING_HEADERS = [
  "STT",
  "MÃ PHÂN LOẠI (SKU)",
  "Tên sản phẩm",
  "TÊN PHÂN LOẠI",
  "MÃ KIOT",
  "GIÁ MÌNH BÁO",
  "GIÁ CẦN THU VỀ",
  "THỜI GIAN ÁP DỤNG",
  "GIÁ MÌNH BÁO CŨ",
  "GIÁ MÌNH BÁO",
  "GIÁ CẦN THU VỀ",
  "GIÁ MÌNH BÁO CŨ",
];

export const PAYMENT_HEADERS = [
  "Tháng",
  "Kỳ thanh toán",
  "Mã đơn hàng",
  "Mã sản phẩm",
  "Tên hàng hóa",
  "Tên NCC",
  "Mã NCC",
  "Số lượng",
  "Giá bán",
  "Phí dịch vụ",
  "Khấu trừ thuế",
  "Giá trị còn lại",
];

export function orderLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Mã đơn hàng": "261011A43HB9Y0",
    "Mã Kiện Hàng": "6070130455008",
    "Ngày đặt hàng": "2026-10-10 23:13",
    "Trạng Thái Đơn Hàng": "Đã giao",
    "Mã vận đơn": "SPXVN0687202",
    "Đơn Vị Vận Chuyển": "Nhanh-SPX Express",
    "Phương thức giao hàng": "Sắp xếp lấy hàng",
    "Ngày giao hàng dự kiến": "2026-10-12 23:59",
    "Thời gian giao hàng": "2026-10-12 18:00",
    "Ngày hủy thành công": "",
    "Tên sản phẩm": "[Top Value] Ben hơi, Cần hơi, Trụ hơi",
    "Tên kho hàng": "WH329",
    "Tên phân loại hàng": "D160",
    "Số lượng": 1,
    "SKU phân loại hàng": "326567746540",
    ...overrides,
  };
}

export function rowFrom(headers: string[], values: Record<string, unknown>): unknown[] {
  return headers.map((header) => values[header] ?? "");
}

// A tab with a blank banner row 1 and the real header on row 2, like every
// tab in the shop 2 order workbook except the product list.
export function bannerGrid(headers: string[], rows: Record<string, unknown>[]): Grid {
  return [headers.map(() => ""), headers, ...rows.map((row) => rowFrom(headers, row))];
}

export function headerOnTopGrid(headers: string[], rows: Record<string, unknown>[]): Grid {
  return [headers, ...rows.map((row) => rowFrom(headers, row))];
}

export const TAB = {
  orders: "4. Danh sách đơn hàng",
  // The real tab name ends with a space.
  cancelled: "5.1Đơn hủy ",
  returns: "5. Trả hàng hoàn tiền",
  products: "1. Danh sách sản phẩm",
};

export function product(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Vendor ID": "310812293272",
    "Vendor Name": "VN_VŨ THỊ THẢO TRANG_MII",
    Warehouse: "WH329",
    "MII - Mã sản phẩm": "48568663858",
    "MII - Mã phân loại": "326567746540",
    "Tên sản phẩm": "[Top Value] Ben hơi, Cần hơi, Trụ hơi",
    "Tên phân loại": "D160",
    "Giá nhập chưa VAT": 63000,
    ...overrides,
  };
}

// 928 of the real tab's 999 rows look like this: Vendor ID / name / warehouse
// filled down, no product.
export const PADDING_PRODUCT_ROW = { "Vendor ID": "310812293272", "Vendor Name": "VN_VŨ THỊ THẢO TRANG_MII", Warehouse: "WH329" };

export function fullWorkbook(extra: { orders?: Record<string, unknown>[]; cancelled?: Record<string, unknown>[]; returns?: Record<string, unknown>[]; products?: Record<string, unknown>[] } = {}) {
  return [
    makeSheet(TAB.orders, bannerGrid(ORDER_HEADERS, extra.orders ?? [orderLine()])),
    makeSheet(
      TAB.cancelled,
      bannerGrid(
        CANCELLED_HEADERS,
        extra.cancelled ?? [orderLine({ "Mã đơn hàng": "261012EMH5BFWD", "Trạng Thái Đơn Hàng": "Đã hủy", "Lý do hủy": "Hủy bởi người mua", "Ngày hủy thành công": "2026-10-21 0:00" })]
      )
    ),
    makeSheet(
      TAB.returns,
      bannerGrid(
        RETURN_HEADERS,
        extra.returns ?? [
          {
            "NCC ghi chú": "đã liên hệ",
            "Kho hàng": "WH329",
            "Mã số khiếu nại": "2610140JVM4UVXA",
            "Mã đơn hàng": "261012F37NYFXM",
            "Phân loại hàng": "40 vít HH+ Tua vít",
            "Trạng thái Trả hàng/Hoàn tiền": "Đã hoàn tiền cho Người mua",
            "Số lượng Hoàn": 1,
            "Tổng số tiền Hoàn trả": 22000,
          },
        ]
      )
    ),
    makeSheet(TAB.products, headerOnTopGrid(PRODUCT_HEADERS, extra.products ?? [product()])),
  ];
}
