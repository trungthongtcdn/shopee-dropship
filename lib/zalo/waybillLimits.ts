import type { ParsedWaybill } from "@/lib/zalo/parseWaybill";

// The most the Zalo bot will take on: same caps as the sorter site (30 MB, 1000 labels). A
// result PDF is about as big as its source and the bridge takes JSON up to 50 MB (base64 adds a
// third), so 30 MB in always fits going out.
export const MAX_WAYBILL_BYTES = 30 * 1024 * 1024;
export const MAX_WAYBILL_LABELS = 1000;
// What the bridge can carry as one file: 50 MB of JSON, and base64 makes a file a third bigger.
export const MAX_SEND_BYTES = 36 * 1024 * 1024;

export class WaybillTooLargeError extends Error {
  constructor(
    message: string,
    // What was found, for the notice in the group: "20,7 MB" or "1200 phiếu".
    public readonly found: string
  ) {
    super(message);
    this.name = "WaybillTooLargeError";
  }
}

export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

// Throws WaybillTooLargeError for a document with more labels than the bot will work through.
export function assertWaybillSize(parsed: Pick<ParsedWaybill, "orders" | "pages" | "labelCount">): void {
  const labels = Math.max(parsed.labelCount, parsed.pages.length, parsed.orders.length);
  if (labels > MAX_WAYBILL_LABELS) {
    throw new WaybillTooLargeError(`Waybill PDF has more than ${MAX_WAYBILL_LABELS} labels`, `${labels} phiếu`);
  }
}
