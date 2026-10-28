import vm from "vm";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// Runs a google-apps-script/*.gs file the way Apps Script would — plain V8, no
// modules — against fake SpreadsheetApp / UrlFetchApp / PropertiesService, so a
// script can be tested without opening a Google account.

export type Grid = unknown[][];

export interface FakeSheet {
  getName(): string;
  getLastRow(): number;
  getLastColumn(): number;
  getRange(row: number, col: number, numRows?: number, numCols?: number): { getValues(): unknown[][] };
}

export function makeSheet(name: string, grid: Grid): FakeSheet {
  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  return {
    getName: () => name,
    getLastRow: () => grid.length,
    getLastColumn: () => width,
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValues: () => {
        const out: unknown[][] = [];
        for (let r = 0; r < numRows; r++) {
          const source = grid[row - 1 + r] ?? [];
          const cells: unknown[] = [];
          for (let c = 0; c < numCols; c++) cells.push(source[col - 1 + c] ?? "");
          out.push(cells);
        }
        return out;
      },
    }),
  };
}

export interface PushedCall {
  url: string;
  secret: string | undefined;
  body: { tab: string; batchLabel?: string; rows: { rowIndex: number; hash: string; data: Record<string, unknown> }[] };
}

interface LoadOptions {
  sheets?: FakeSheet[];
  // Spreadsheets reachable through SpreadsheetApp.openByUrl (PaymentSync.gs).
  external?: Record<string, FakeSheet[]>;
  props?: Record<string, string>;
  // Status code for each UrlFetchApp.fetch call, in order; the last one repeats. Default 200.
  statuses?: number[];
}

export function loadScripts(files: string[], options: LoadOptions = {}) {
  const props: Record<string, string> = { SYNC_WEBHOOK_URL: "https://app.test/api/sync/webhook", SYNC_SECRET: "shop2-secret", ...options.props };
  const logs: string[] = [];
  const calls: PushedCall[] = [];
  const triggers: { handler: string; everyMinutes?: number }[] = [];
  const statuses = options.statuses ?? [200];

  const spreadsheet = (sheets: FakeSheet[]) => ({
    getSheetByName: (name: string) => sheets.find((sheet) => sheet.getName() === name) ?? null,
    getSheets: () => sheets,
  });

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet(options.sheets ?? []),
      openByUrl: (url: string) => {
        const sheets = options.external?.[url];
        if (!sheets) throw new Error(`no such spreadsheet: ${url}`);
        return spreadsheet(sheets);
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => (key in props ? props[key] : null),
        setProperty: (key: string, value: string) => {
          props[key] = value;
        },
      }),
    },
    UrlFetchApp: {
      fetch: (url: string, fetchOptions: { headers?: Record<string, string>; payload: string }) => {
        calls.push({ url, secret: fetchOptions.headers?.["X-Sync-Secret"], body: JSON.parse(fetchOptions.payload) });
        const code = statuses[Math.min(calls.length - 1, statuses.length - 1)];
        return { getResponseCode: () => code, getContentText: () => "{}" };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "SHA_256" },
      // Apps Script returns signed bytes (-128..127).
      computeDigest: (_algorithm: string, value: string) =>
        Array.from(crypto.createHash("sha256").update(value).digest()).map((byte) => (byte > 127 ? byte - 256 : byte)),
      sleep: () => undefined,
    },
    Logger: { log: (message: unknown) => logs.push(String(message)) },
    ScriptApp: {
      newTrigger: (handler: string) => {
        const trigger: { handler: string; everyMinutes?: number } = { handler };
        const builder = {
          timeBased: () => builder,
          everyMinutes: (minutes: number) => {
            trigger.everyMinutes = minutes;
            return builder;
          },
          create: () => {
            triggers.push(trigger);
          },
        };
        return builder;
      },
    },
  };

  const context = vm.createContext(sandbox);
  for (const file of files) {
    const source = fs.readFileSync(path.join(process.cwd(), "google-apps-script", file), "utf8");
    vm.runInContext(source, context, { filename: file });
  }

  return {
    run: (code: string) => vm.runInContext(code, context),
    calls,
    logs,
    props,
    triggers,
    callFor: (tab: string) => calls.filter((call) => call.body.tab === tab),
  };
}
