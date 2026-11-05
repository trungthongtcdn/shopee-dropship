import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { assignKho, parseKhoOverrides } from "./khoGiao";
import type { WaybillPage } from "./items";
import type { SheetLayout } from "./layout";

// A waybill PDF the bot saw in the Zalo group, kept (with the orders read from it and the Kiot
// lines the price sheet gave them) so that the team can look at the kho gửi of every order, fill
// in the ones the sheet couldn't decide, and only then send the files into the group.

export const DRAFT_KEEP_DAYS = 14;

export interface WaybillDraft {
  id: number;
  threadId: string;
  threadType: "user" | "group";
  pdfUrl: string;
  pages: WaybillPage[];
  layout: SheetLayout | undefined;
  labelCount: number | null;
  khoOptions: string[];
  // The kho gửi typed on the page: order id → kho.
  overrides: Map<string, string>;
  createdAt: Date;
  // When the files were posted into the group; null while they are held back.
  sentAt: Date | null;
}

type Row = Awaited<ReturnType<typeof prisma.waybillDraft.findUniqueOrThrow>>;
type RowWithoutPdf = Omit<Row, "pdfData">;

const withoutPdf = { id: true, threadId: true, threadType: true, pdfUrl: true, pages: true, layout: true, labelCount: true, khoOptions: true, overrides: true, createdAt: true, sentAt: true } as const;

function toDraft(row: RowWithoutPdf): WaybillDraft {
  let overrides = new Map<string, string>();
  try {
    overrides = parseKhoOverrides(row.overrides);
  } catch {
    // a bad stored value is treated as "no edits" rather than breaking the page
  }
  return {
    id: row.id,
    threadId: row.threadId,
    threadType: row.threadType === "user" ? "user" : "group",
    pdfUrl: row.pdfUrl,
    pages: row.pages as unknown as WaybillPage[],
    layout: (row.layout as unknown as SheetLayout | null) ?? undefined,
    labelCount: row.labelCount,
    khoOptions: Array.isArray(row.khoOptions) ? (row.khoOptions as unknown[]).filter((kho): kho is string => typeof kho === "string") : [],
    overrides,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}

export interface CreateDraftInput {
  threadId: string;
  threadType: "user" | "group";
  pdfUrl: string;
  pdf: Buffer;
  pages: WaybillPage[];
  layout?: SheetLayout;
  labelCount: number | null;
  khoOptions?: readonly string[];
}

// The draft of this PDF in this thread, made from what was just read: the one already kept (the same
// link posted again, or a cycle retried), refreshed with the new reading but keeping its edits, else a
// new one. `created` says which.
export async function createDraft(input: CreateDraftInput): Promise<{ draft: WaybillDraft; created: boolean }> {
  const where = { threadId_pdfUrl: { threadId: input.threadId, pdfUrl: input.pdfUrl } };
  const content = {
    pdfData: input.pdf,
    pages: input.pages as unknown as Prisma.InputJsonValue,
    layout: (input.layout as unknown as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    labelCount: input.labelCount,
    khoOptions: [...(input.khoOptions ?? [])],
  };
  const existing = await prisma.waybillDraft.findUnique({ where, select: { id: true } });
  if (existing) {
    const row = await prisma.waybillDraft.update({ where: { id: existing.id }, data: content, select: withoutPdf });
    return { draft: toDraft(row), created: false };
  }
  const row = await prisma.waybillDraft.create({ data: { threadId: input.threadId, threadType: input.threadType, pdfUrl: input.pdfUrl, ...content }, select: withoutPdf });
  return { draft: toDraft(row), created: true };
}

export async function loadDraft(id: number): Promise<WaybillDraft | null> {
  const row = await prisma.waybillDraft.findUnique({ where: { id }, select: withoutPdf });
  return row ? toDraft(row) : null;
}

export async function findDraft(threadId: string, pdfUrl: string): Promise<WaybillDraft | null> {
  const row = await prisma.waybillDraft.findUnique({ where: { threadId_pdfUrl: { threadId, pdfUrl } }, select: withoutPdf });
  return row ? toDraft(row) : null;
}

export async function loadDraftPdf(id: number): Promise<Buffer | null> {
  const row = await prisma.waybillDraft.findUnique({ where: { id }, select: { pdfData: true } });
  return row ? Buffer.from(row.pdfData) : null;
}

// Replaces the edits of a draft. False when there is no such draft.
export async function saveOverrides(id: number, overrides: ReadonlyMap<string, string>): Promise<boolean> {
  const { count } = await prisma.waybillDraft.updateMany({ where: { id }, data: { overrides: Object.fromEntries(overrides) } });
  return count > 0;
}

export async function markDraftSent(id: number, at: Date = new Date()): Promise<void> {
  await prisma.waybillDraft.updateMany({ where: { id }, data: { sentAt: at } });
}

// Drafts hold a whole PDF each: the old ones go.
export async function pruneDrafts(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.waybillDraft.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DRAFT_KEEP_DAYS * 24 * 60 * 60 * 1000) } } });
  return count;
}

// How many orders have a kho gửi for people to decide: their Kiot codes are in different kho and
// nobody has chosen one yet. (An order the sheet knows nothing of doesn't count — there is nothing to
// decide from, and holding every file back for that would stop the warehouse from working.)
export function countHandFill(pages: readonly WaybillPage[], overrides: ReadonlyMap<string, string> = new Map()): number {
  return assignKho(pages, overrides).filter((page) => page.khoAuto?.reason === "mixed" && !page.khoGiao).length;
}

export function needsHandFill(pages: readonly WaybillPage[], overrides: ReadonlyMap<string, string> = new Map()): boolean {
  return countHandFill(pages, overrides) > 0;
}

// The page that opens a draft, as a link for the group; null when the site's address isn't configured.
export function draftUrl(id: number, shopSlug: string): string | null {
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return base ? `${base}/dashboard/dong-don/phieu/${id}?shop=${encodeURIComponent(shopSlug)}` : null;
}
