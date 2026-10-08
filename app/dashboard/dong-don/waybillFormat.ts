// The ways the re-ordered waybill PDF can be laid out: "same" keeps the layout of the
// PDF that was sent, the others put that many labels on each A4 sheet.
export const WAYBILL_FORMAT_OPTIONS = [
  { value: "same", label: "Giữ như file gốc" },
  { value: "2", label: "2 phiếu / trang" },
  { value: "4", label: "4 phiếu / trang" },
  { value: "6", label: "6 phiếu / trang" },
  { value: "9", label: "9 phiếu / trang" },
] as const;
