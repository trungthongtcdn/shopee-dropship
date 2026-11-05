// What the page that lists the orders for editing their kho gửi shows, and the order the files
// are cut in: the orders grouped kho by kho (see khoGiao.ts), identical orders together inside
// each kho. Pure: the same blocks drive the Excel, the PDFs and the page, so they can't disagree.

import { groupWaybillPages, type KhoReason, type WaybillGroup, type WaybillPage } from "./items";
import { assignKho, canonicalKho, compareKho, DEFAULT_KHO, khoKey, splitByKho } from "./khoGiao";

// One product line of an order, as the page shows it beside the order's kho gửi: what the kho is
// worked out from.
export interface KhoLine {
  // The Kiot code, or the SKU where the sheet has no Kiot code for it.
  code: string;
  quantity: number;
  // The kho the price sheet gives this line for the order's shop; null when it gives none.
  kho: string | null;
}

// One order as the page lists it.
export interface KhoOrder {
  orderId: string;
  trackingCode: string | null;
  shopName: string;
  products: string;
  lines: KhoLine[];
  // The kho the order is at now (after any edit; "" = none yet), and what the price sheet decided
  // on its own.
  kho: string;
  auto: string;
  reason: KhoReason;
}

export interface KhoSummary {
  // What an order's kho can be changed to.
  options: string[];
  // One entry per kho, in the order of the files ("" = orders with no kho yet).
  groups: { kho: string; orderCount: number }[];
  // Every order, in the order of the Excel.
  orders: KhoOrder[];
  // Orders whose kho differs from the sheet's decision because it was edited.
  edited: number;
  // Orders that still have no kho gửi.
  blank: number;
}

export interface KhoBlockWithGroups {
  kho: string;
  groups: WaybillGroup[];
}

export interface KhoPlan {
  pages: WaybillPage[];
  blocks: KhoBlockWithGroups[];
  summary: KhoSummary;
}

function productsOf(page: WaybillPage): string {
  const text = page.items.map((item) => `${item.name}${item.variant ? ` [${item.variant}]` : ""} ×${item.quantity}`).join(" + ");
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function linesOf(page: WaybillPage): KhoLine[] {
  return page.items.flatMap((item): KhoLine[] => {
    if (item.kiotLines && item.kiotLines.length > 0) {
      return item.kiotLines.map((line) => ({ code: line.kiotCode || line.sku, quantity: line.quantity, kho: line.khoGiao ?? null }));
    }
    return item.sku ? [{ code: item.sku, quantity: item.quantity, kho: null }] : [];
  });
}

// The pages with their kho gửi (the sheet's decision, or the edit made for the order), cut into
// one block per kho with identical orders grouped inside it, and what the page shows of it.
// `knownKhos`: the kho the price sheet knows, offered besides the ones the orders are at.
export function planKho(pages: readonly WaybillPage[], overrides: ReadonlyMap<string, string> = new Map(), knownKhos: readonly string[] = []): KhoPlan {
  const assigned = assignKho(pages, overrides);
  const blocks = splitByKho(assigned).map((block) => ({ kho: block.kho, groups: groupWaybillPages(block.pages) }));
  const orders = blocks.flatMap((block) => block.groups.flatMap((group) => group.pages));

  const options = new Map<string, string>();
  for (const kho of [DEFAULT_KHO, ...knownKhos, ...blocks.map((block) => block.kho), ...orders.map((page) => page.khoAuto?.kho ?? "")]) {
    if (kho.trim() !== "") options.set(khoKey(kho), canonicalKho(kho));
  }

  const summary: KhoSummary = {
    options: [...options.values()].sort(compareKho),
    groups: blocks.map((block) => ({ kho: block.kho, orderCount: block.groups.reduce((sum, group) => sum + group.pages.length, 0) })),
    orders: orders.map((page) => ({
      orderId: page.shopeeOrderId,
      trackingCode: page.trackingCode,
      shopName: page.shopName ?? "",
      products: productsOf(page),
      lines: linesOf(page),
      kho: page.khoGiao ?? "",
      auto: page.khoAuto?.kho ?? "",
      reason: page.khoAuto?.reason ?? "unknown",
    })),
    edited: orders.filter((page) => khoKey(page.khoGiao ?? "") !== khoKey(page.khoAuto?.kho ?? "")).length,
    blank: orders.filter((page) => (page.khoGiao ?? "") === "").length,
  };
  return { pages: assigned, blocks, summary };
}
