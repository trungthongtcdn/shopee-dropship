import { describe, it, expect } from "vitest";
import { reorderPdfPages, waybillSortedPdfFileName } from "@/lib/waybill/pdf";
import { waybillExcelFileName } from "@/lib/waybill/excel";
import { makePdf, pageWidths as widths } from "./pdfFixture";

describe("reorderPdfPages", () => {
  it("puts the pages in the requested order", async () => {
    const source = await makePdf(6);
    expect(await widths(await reorderPdfPages(source, [3, 0, 5, 1, 2, 4]))).toEqual([104, 101, 106, 102, 103, 105]);
  });

  it("keeps pages the order list doesn't mention, after the listed ones, in their original order", async () => {
    // e.g. a cover page or a page the parser didn't recognise as an order.
    const source = await makePdf(4);
    expect(await widths(await reorderPdfPages(source, [2]))).toEqual([103, 101, 102, 104]);
  });

  it("uses each page once even if the list repeats or overshoots", async () => {
    const source = await makePdf(3);
    expect(await widths(await reorderPdfPages(source, [1, 1, 99, -1, 0]))).toEqual([102, 101, 103]);
  });

  it("returns the same page sequence for an empty order", async () => {
    const source = await makePdf(3);
    expect(await widths(await reorderPdfPages(source, []))).toEqual([101, 102, 103]);
  });

  it("does not touch the source buffer", async () => {
    const source = await makePdf(3);
    const before = Buffer.from(source);
    await reorderPdfPages(source, [2, 1, 0]);
    expect(source.equals(before)).toBe(true);
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(reorderPdfPages(Buffer.from("definitely not a pdf"), [0])).rejects.toThrow();
  });
});

describe("waybillSortedPdfFileName", () => {
  it("shares its name stem with the Excel so the two files pair up", () => {
    const at = new Date("2026-10-07T03:15:00Z");
    expect(waybillSortedPdfFileName(at)).toBe("danh-sach-don-gom-nhom-20261007-1015.pdf");
    expect(waybillSortedPdfFileName(at).replace(/\.pdf$/, "")).toBe(waybillExcelFileName(at).replace(/\.xlsx$/, ""));
  });
});
