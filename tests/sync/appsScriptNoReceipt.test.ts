import { describe, it, expect } from "vitest";
import vm from "vm";
import fs from "fs";
import path from "path";

// NoReceiptNeeded.gs run the way Apps Script runs it (plain V8) against a small WRITABLE fake
// spreadsheet — the shared helper's fake sheet is read-only.

const STATUS = "Trạng thái Trả hàng/Hoàn tiền";
const RECEIPT = "Trạng thái nhận/Check Dup";
const BUYER_CANCELLED = "Yêu cầu của Người mua đã hủy";
const FILLED = "Không cần nhận";

const letterOf = (n: number) => {
  let text = "";
  for (let rest = n; rest > 0; rest = Math.floor((rest - 1) / 26)) text = String.fromCharCode(65 + ((rest - 1) % 26)) + text;
  return text;
};
const numberOf = (letters: string) => [...letters].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0);

type Grid = unknown[][];

function fakeSheet(name: string, grid: Grid, formulas: Record<string, string> = {}, maxColumns?: number) {
  const sheet = {
    grid,
    pastedFormats: 0,
    maxColumns: maxColumns ?? Math.max(0, ...grid.map((row) => row.length)),
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () =>
      Math.max(
        0,
        ...grid.map((row) => {
          let n = row.length;
          while (n > 0 && (row[n - 1] === "" || row[n - 1] === undefined)) n--;
          return n;
        })
      ),
    getMaxColumns: () => sheet.maxColumns,
    insertColumnAfter: () => {
      sheet.maxColumns += 1;
    },
    getRange(row: number, col: number, numRows = 1, numCols = 1) {
      const cell = (r: number, c: number) => grid[row - 1 + r]?.[col - 1 + c] ?? "";
      const each = <T,>(read: (r: number, c: number) => T) => Array.from({ length: numRows }, (_, r) => Array.from({ length: numCols }, (_, c) => read(r, c)));
      return {
        getValues: () => each(cell),
        getFormulas: () => each((r, c) => formulas[`${row + r},${col + c}`] ?? ""),
        getFormula: () => formulas[`${row},${col}`] ?? "",
        getA1Notation: () => `${letterOf(col)}${row}`,
        setValue: (value: unknown) => {
          while (grid.length < row) grid.push([]);
          grid[row - 1][col - 1] = value;
        },
        copyTo: () => {
          sheet.pastedFormats += 1;
        },
      };
    },
    getRangeList: (cells: string[]) => ({
      setValue: (value: unknown) =>
        cells.forEach((a1) => {
          const match = /^([A-Z]+)(\d+)$/.exec(a1);
          if (!match) throw new Error(`bad A1 notation: ${a1}`);
          sheet.getRange(Number(match[2]), numberOf(match[1])).setValue(value);
        }),
    }),
  };
  return sheet;
}

function load(sheets: ReturnType<typeof fakeSheet>[], replace?: [string, string]) {
  const logs: string[] = [];
  const props: Record<string, string> = {};
  const triggers: { handler: string; everyMinutes?: number }[] = [];
  const deleted: string[] = [];
  const existing = [{ getHandlerFunction: () => "fillNoReceiptNeeded" }, { getHandlerFunction: () => "syncAllTabs" }];
  const sandbox = {
    Logger: { log: (message: unknown) => logs.push(String(message)) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    PropertiesService: { getScriptProperties: () => ({ setProperty: (key: string, value: string) => void (props[key] = value) }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => sheets }), CopyPasteType: { PASTE_FORMAT: "FORMAT" } },
    ScriptApp: {
      getProjectTriggers: () => existing,
      deleteTrigger: (trigger: { getHandlerFunction(): string }) => void deleted.push(trigger.getHandlerFunction()),
      newTrigger: (handler: string) => {
        const trigger: { handler: string; everyMinutes?: number } = { handler };
        const builder = {
          timeBased: () => builder,
          everyMinutes: (minutes: number) => ((trigger.everyMinutes = minutes), builder),
          create: () => void triggers.push(trigger),
        };
        return builder;
      },
    },
  };
  let source = fs.readFileSync(path.join(process.cwd(), "google-apps-script", "NoReceiptNeeded.gs"), "utf8");
  if (replace) source = source.replace(replace[0], replace[1]);
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "NoReceiptNeeded.gs" });
  return { run: (code: string) => vm.runInContext(code, context), logs, props, triggers, deleted };
}

// A tab with the status header in column K, the way both shops' return tabs have it.
function header(overrides: Record<number, string> = {}) {
  const cells = Array.from({ length: 30 }, (_, i) => `Cột ${letterOf(i + 1)}`);
  cells[10] = STATUS;
  for (const [column, text] of Object.entries(overrides)) cells[Number(column) - 1] = text;
  return cells;
}
function line(status: string, receipt: unknown = "") {
  const cells: unknown[] = Array.from({ length: 30 }, () => "x");
  cells[10] = status;
  cells[28] = receipt;
  return cells;
}
const banner = () => ["MII điền", ...Array(29).fill("")];

describe("NoReceiptNeeded.gs", () => {
  it("fills Không cần nhận on rows whose status is the buyer's cancelled request, whichever way hủy / huỷ is typed", () => {
    const grid = [banner(), header({ 29: RECEIPT }), line(BUYER_CANCELLED), line("Yêu cầu của Người mua đã huỷ"), line(BUYER_CANCELLED.normalize("NFD")), line("  yêu cầu của người mua  đã hủy ")];
    const script = load([fakeSheet("5. Trả hàng/hoàn tiền", grid)]);

    script.run("fillNoReceiptNeeded()");

    expect(grid.slice(2).map((row) => row[28])).toEqual([FILLED, FILLED, FILLED, FILLED]);
  });

  it("leaves every other status, an empty status and a typed value alone", () => {
    const grid = [banner(), header({ 29: RECEIPT }), line("Đã hoàn tiền cho Người mua"), line(""), line(BUYER_CANCELLED, "Đã nhận"), line(BUYER_CANCELLED, "   ")];
    const script = load([fakeSheet("5. Trả hàng/hoàn tiền", grid)]);

    script.run("fillNoReceiptNeeded()");

    expect(grid.slice(2).map((row) => row[28])).toEqual(["", "", "Đã nhận", FILLED]);
  });

  it("never writes over a formula in the receipt column", () => {
    const grid = [banner(), header({ 29: RECEIPT }), line(BUYER_CANCELLED, "")];
    const script = load([fakeSheet("5", grid, { "3,29": '=IF(A3="","","x")' })]);

    script.run("fillNoReceiptNeeded()");

    expect(grid[2][28]).toBe("");
  });

  it("leaves a column that is an ARRAYFORMULA alone", () => {
    const grid = [banner(), header({ 29: RECEIPT }), line(BUYER_CANCELLED, "")];
    const script = load([fakeSheet("5", grid, { "2,29": '=ARRAYFORMULA(IF(K3:K="","","x"))' })]);

    script.run("fillNoReceiptNeeded()");

    expect(grid[2][28]).toBe("");
    expect(script.logs.some((message) => /array formula/.test(message))).toBe(true);
  });

  it("adds the receipt column, formatted like the header before it, when the tab has none", () => {
    const grid = [banner(), header(), line(BUYER_CANCELLED)];
    const sheet = fakeSheet("5. Trả hàng/hoàn tiền", grid);
    const script = load([sheet]);

    script.run("fillNoReceiptNeeded()");

    expect(grid[1][30]).toBe(RECEIPT);
    expect(sheet.pastedFormats).toBe(1);
    expect(grid[2][30]).toBe(FILLED);
  });

  it("makes room when the sheet has no spare column left", () => {
    const sheet = fakeSheet("5", [banner(), header(), line(BUYER_CANCELLED)], {}, 30);
    load([sheet]).run("fillNoReceiptNeeded()");
    expect(sheet.maxColumns).toBe(31);
  });

  it("finds the columns by header name, wherever they are and however the receipt header is spaced", () => {
    // shop 2 style: the receipt header is typed with spaces round the slash, in another column
    const grid = [banner(), header({ 5: "Trạng thái nhận / Check Dup" }), line(BUYER_CANCELLED)];
    grid[2][4] = "";
    load([fakeSheet("5. Trả hàng hoàn tiền", grid)]).run("fillNoReceiptNeeded()");
    expect(grid[2][4]).toBe(FILLED);
    expect(grid[1]).toHaveLength(30);
  });

  it("covers the return tab of both shops and ignores every tab without the status header", () => {
    const shop1 = [banner(), header({ 29: RECEIPT }), line(BUYER_CANCELLED)];
    const shop2 = [banner(), header({ 29: RECEIPT }), line(BUYER_CANCELLED)];
    const orders = [banner(), ["Mã đơn hàng", "Trạng Thái Đơn Hàng"], ["1", BUYER_CANCELLED]];
    const script = load([fakeSheet("5. Trả hàng/hoàn tiền", shop1), fakeSheet("5. Trả hàng hoàn tiền", shop2), fakeSheet("2. Danh sách đơn hàng", orders)]);

    script.run("fillNoReceiptNeeded()");

    expect([shop1[2][28], shop2[2][28]]).toEqual([FILLED, FILLED]);
    expect(orders[2]).toEqual(["1", BUYER_CANCELLED]);
  });

  it("is idempotent", () => {
    const grid = [banner(), header({ 29: RECEIPT }), line(BUYER_CANCELLED)];
    const script = load([fakeSheet("5", grid)]);
    script.run("fillNoReceiptNeeded()");
    script.logs.length = 0;

    script.run("fillNoReceiptNeeded()");

    expect(script.logs.some((message) => /: 0 ô đã điền/.test(message))).toBe(true);
  });

  it("manualTestNoReceipt writes nothing and adds no column, only logs what it would fill", () => {
    const grid = [banner(), header(), line(BUYER_CANCELLED), line(BUYER_CANCELLED)];
    const script = load([fakeSheet("5", grid)]);

    script.run("manualTestNoReceipt()");

    expect(grid[1]).toHaveLength(30);
    expect(grid[2][28]).toBe("");
    expect(script.logs.some((message) => /2 ô sẽ điền/.test(message))).toBe(true);
  });

  it("warns and changes nothing when no tab has the status header", () => {
    const orders = [["a"], ["b"]];
    const script = load([fakeSheet("x", orders)]);
    script.run("fillNoReceiptNeeded()");
    expect(script.logs.some((message) => /WARNING/.test(message))).toBe(true);
    expect(orders).toEqual([["a"], ["b"]]);
  });

  it("adds the columns listed in NR_EXTRA_COLUMNS once, and never a second copy of one that exists", () => {
    const grid = [banner(), header({ 29: RECEIPT }), line("x")];
    const script = load([fakeSheet("5", grid)], ["var NR_EXTRA_COLUMNS = [];", `var NR_EXTRA_COLUMNS = ["Ngày nhận", "${RECEIPT}"];`]);

    script.run("fillNoReceiptNeeded()");
    script.run("fillNoReceiptNeeded()");

    expect(grid[1].filter((cell) => cell === "Ngày nhận")).toHaveLength(1);
    expect(grid[1].filter((cell) => cell === RECEIPT)).toHaveLength(1);
  });

  it("installs one trigger every 10 minutes, replacing its own earlier one and leaving the sync's alone", () => {
    const script = load([]);
    script.run("createNoReceiptTrigger()");
    expect(script.triggers).toEqual([{ handler: "fillNoReceiptNeeded", everyMinutes: 10 }]);
    expect(script.deleted).toEqual(["fillNoReceiptNeeded"]);
  });
});
