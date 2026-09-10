import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseReconciliationExcel } from "@/lib/reconcile/parseExcel";

function bufferFromRows(rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "buffer" }) as Buffer;
}

describe("parseReconciliationExcel", () => {
  it("parses valid rows", () => {
    const buffer = bufferFromRows([
      { shopee_order_id: "SP001", amount: 20000, status: "completed" },
      { shopee_order_id: "SP002", amount: 15000, status: "completed" },
    ]);

    const result = parseReconciliationExcel(buffer);
    expect(result.missingColumns).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].shopeeOrderId).toBe("SP001");
  });

  it("reports missing required columns", () => {
    const buffer = bufferFromRows([{ foo: "bar" }]);
    const result = parseReconciliationExcel(buffer);
    expect(result.missingColumns).toEqual(
      expect.arrayContaining(["shopeeOrderId", "amount", "status"])
    );
  });

  it("skips rows with invalid amount and reports rowErrors", () => {
    const buffer = bufferFromRows([
      { shopee_order_id: "SP001", amount: "not-a-number", status: "completed" },
    ]);
    const result = parseReconciliationExcel(buffer);
    expect(result.rows).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(1);
  });
});
