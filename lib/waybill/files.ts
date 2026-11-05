import { buildWaybillExcel, waybillExcelFileName, waybillKhoFileName } from "./excel";
import { composeLabelsPdf, type PerPage } from "./compose";
import { labelMismatchMessage, orderedPageIndexes, type WaybillGroup, type WaybillPage } from "./items";
import type { SheetLayout } from "./layout";
import { planKho, type KhoSummary } from "./khoSummary";
import { reorderPdfLabels, reorderPdfPages, waybillSortedPdfFileName } from "./pdf";

// The files the warehouse gets for one waybill PDF: the overall Excel and PDF (every order, kho by
// kho, identical orders together inside each kho) and — when the orders are at more than one kho —
// one Excel and one PDF per kho, the way the Convert site splits them. The Excel and the PDF of a
// kho walk the very same group list, so they can never disagree about the order.

export interface WaybillFile {
  name: string;
  data: Buffer;
}

export interface KhoFiles {
  // "" = the orders that have no kho gửi yet.
  kho: string;
  orderCount: number;
  excel: WaybillFile;
  // null when the pages couldn't be re-ordered (the Excel is still good).
  pdf: WaybillFile | null;
}

export interface WaybillFileSet {
  orderCount: number;
  summary: KhoSummary;
  excel: WaybillFile;
  pdf: WaybillFile | null;
  // Empty when every order is at one kho: the overall files are then that kho's files.
  perKho: KhoFiles[];
}

export interface WaybillFileSetInput {
  pages: WaybillPage[];
  at: Date;
  // The PDF the pages were read from; without it only the Excel files are made.
  sourcePdf?: Buffer | null;
  // Set when the PDF has several labels tiled on each sheet (see ParsedWaybill).
  layout?: SheetLayout;
  // Labels per A4 sheet wanted for the re-ordered PDF; null/absent keeps the source's layout.
  perPage?: PerPage | null;
  // Labels the PDF holds; more than pages.length puts the red alert on the overall Excel.
  labelCount?: number | null;
  // Edits to the sheet's kho gửi: order id → kho.
  overrides?: ReadonlyMap<string, string>;
  // The kho the price sheet knows (offered besides the ones the orders are at).
  khoOptions?: readonly string[];
  // Which files to make besides the overall Excel (always made): the overall PDF (default: yes,
  // when there is a source PDF) and the per-kho files (default: yes).
  overallPdf?: boolean;
  splitKho?: boolean;
}

async function renderPdf(
  sourcePdf: Buffer,
  layout: SheetLayout | undefined,
  perPage: PerPage | null | undefined,
  groups: WaybillGroup[],
  listedOnly: boolean,
  label: string
): Promise<Buffer | null> {
  try {
    const order = orderedPageIndexes(groups);
    // A layout was asked for: N labels per A4 sheet, whatever the source looked like. Otherwise keep
    // the source's own: several labels per sheet move label (cell) by label, one label per page
    // moves whole pages.
    return perPage
      ? await composeLabelsPdf(sourcePdf, layout ?? null, order, perPage, listedOnly)
      : layout
        ? await reorderPdfLabels(sourcePdf, layout, order, listedOnly)
        : await reorderPdfPages(sourcePdf, order, listedOnly);
  } catch (error) {
    console.error(`[waybill-pdf] re-ordering failed (${label}):`, error);
    return null;
  }
}

// Throws only when an Excel can't be built (nothing useful is left then); a PDF that can't be
// made is null.
export async function buildWaybillFileSet(input: WaybillFileSetInput): Promise<WaybillFileSet> {
  const { pages, at, sourcePdf = null, layout, perPage, labelCount, overrides, khoOptions, overallPdf = true, splitKho = true } = input;
  const plan = planKho(pages, overrides, khoOptions);
  const allGroups = plan.blocks.flatMap((block) => block.groups);
  const orderCount = pages.length;

  const excel = {
    name: waybillExcelFileName(at, orderCount),
    data: await buildWaybillExcel(allGroups, labelMismatchMessage(orderCount, labelCount)),
  };
  const pdfData = sourcePdf && overallPdf ? await renderPdf(sourcePdf, layout, perPage, allGroups, false, "overall") : null;
  const pdf = pdfData ? { name: waybillSortedPdfFileName(at, orderCount), data: pdfData } : null;

  const perKho: KhoFiles[] = [];
  if (splitKho && plan.blocks.length > 1) {
    for (const block of plan.blocks) {
      const count = block.groups.reduce((sum, group) => sum + group.pages.length, 0);
      const khoPdf = sourcePdf ? await renderPdf(sourcePdf, layout, perPage, block.groups, true, `kho ${block.kho || "(none)"}`) : null;
      perKho.push({
        kho: block.kho,
        orderCount: count,
        excel: { name: waybillKhoFileName(at, count, block.kho, "xlsx"), data: await buildWaybillExcel(block.groups) },
        pdf: khoPdf ? { name: waybillKhoFileName(at, count, block.kho, "pdf"), data: khoPdf } : null,
      });
    }
  }
  return { orderCount, summary: plan.summary, excel, pdf, perKho };
}
