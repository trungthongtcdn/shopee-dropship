// Server runs in UTC (Docker default) but Luân reads every date/time as
// giờ Việt Nam — every display formatter here pins timeZone explicitly
// instead of relying on the server's local clock, which would otherwise
// vary by deploy host and can shift the displayed calendar day near
// midnight UTC (e.g. 2026-10-01T20:00Z is already 2026-10-02 in VN).
const VN_TIME_ZONE = "Asia/Ho_Chi_Minh";

export function formatDateVN(value: Date | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: VN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function formatDateTimeVN(value: Date | null | undefined): string {
  if (!value) return "-";
  return value.toLocaleString("vi-VN", { timeZone: VN_TIME_ZONE });
}
