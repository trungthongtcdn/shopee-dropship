import * as XLSX from "xlsx";

export interface ParsedExcelRow {
  rowNumber: number;
  shopeeOrderId: string;
  amount: number;
  status: string;
}

export interface ParseResult {
  rows: ParsedExcelRow[];
  missingColumns: string[];
  rowErrors: { rowNumber: number; issue: string }[];
}

const COLUMN_ALIASES: Record<"shopeeOrderId" | "amount" | "status", string[]> = {
  shopeeOrderId: ["shopee_order_id", "order id", "mã đơn hàng", "ma don hang"],
  amount: ["amount", "total_amount", "số tiền", "so tien"],
  status: ["status", "trạng thái", "trang thai"],
};

function normalizeHeader(header: string) {
  return header.trim().toLowerCase();
}

function findColumnKey(headers: string[], aliases: string[]) {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const index = normalized.indexOf(alias);
    if (index !== -1) return headers[index];
  }
  return null;
}

export function parseReconciliationExcel(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (records.length === 0) {
    return { rows: [], missingColumns: Object.keys(COLUMN_ALIASES), rowErrors: [] };
  }

  const headers = Object.keys(records[0]);
  const orderIdKey = findColumnKey(headers, COLUMN_ALIASES.shopeeOrderId);
  const amountKey = findColumnKey(headers, COLUMN_ALIASES.amount);
  const statusKey = findColumnKey(headers, COLUMN_ALIASES.status);

  const missingColumns: string[] = [];
  if (!orderIdKey) missingColumns.push("shopeeOrderId");
  if (!amountKey) missingColumns.push("amount");
  if (!statusKey) missingColumns.push("status");

  if (missingColumns.length > 0) {
    return { rows: [], missingColumns, rowErrors: [] };
  }

  const rows: ParsedExcelRow[] = [];
  const rowErrors: { rowNumber: number; issue: string }[] = [];

  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const orderId = String(record[orderIdKey!]).trim();
    const amount = Number(record[amountKey!]);
    const status = String(record[statusKey!]).trim();

    if (!orderId || Number.isNaN(amount)) {
      rowErrors.push({ rowNumber, issue: "missing order id or invalid amount" });
      return;
    }

    rows.push({ rowNumber, shopeeOrderId: orderId, amount, status });
  });

  return { rows, missingColumns: [], rowErrors };
}
