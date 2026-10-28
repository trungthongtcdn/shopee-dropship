// Shop 2's counterpart of PricingSync.gs — bound to the workbook "Top dữ liệu luân
// up" (shop 2's SKU -> price reference file), tab "1.Top Thông tin hàng hoá".
// Same backend tab ("sku_pricing"), which only patches kiot_code / collect_price
// onto Product rows that already exist from the order workbook's product list
// (Sync.shop2.gs, tab "1. Danh sách sản phẩm") — see applySkuPricingPayload in
// lib/sync/apply.ts. So run the order workbook's sync first.
//
// What differs from PricingSync.gs (shop 1's, left as it is):
//  - Another tab name.
//  - The header row repeats some names ("GIÁ MÌNH BÁO" / "GIÁ CẦN THU VỀ" appear in
//    both column F-G and column J-K, the second pair empty). PricingSync.gs lets the
//    later column overwrite the earlier one, which would blank the price; here a
//    repeated header keeps the first value that is not empty.
//  - Rows without a SKU are dropped, and the tab is not pushed when a header the
//    server reads is missing (logged, and stored in the `last_error` property).
//
// Payments are not synced from this workbook: shop 2's payment file is editable, so
// PaymentSync.gs is installed in that file itself (see README, "Shop 2").

var PRICING_SHEET_NAME = "1.Top Thông tin hàng hoá";
var PRICING_TAB = "sku_pricing";
var PRICING_HEADER_ROW = 1;
var PRICING_KEY_HEADER = "MÃ PHÂN LOẠI (SKU)";
var PRICING_REQUIRED_HEADERS = ["MÃ PHÂN LOẠI (SKU)", "MÃ KIOT", "GIÁ CẦN THU VỀ"];

function pricingComputeRowHash(values) {
  var raw = values.join("|");
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest
    .map(function (byte) {
      var v = (byte + 256) % 256;
      return v.toString(16).padStart(2, "0");
    })
    .join("");
}

function pricingRecordSyncError(message) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("last_error", String(message).slice(0, 500));
  props.setProperty("last_error_at", new Date().toISOString());
}

function pricingNormalizeName(value) {
  return String(value).replace(/\s+/g, " ").trim().normalize("NFC").toLowerCase();
}

function pricingIsBlank(value) {
  return value === "" || value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function pricingFindSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var exact = spreadsheet.getSheetByName(PRICING_SHEET_NAME);
  if (exact) return exact;

  var wanted = pricingNormalizeName(PRICING_SHEET_NAME);
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (pricingNormalizeName(sheets[i].getName()) === wanted) return sheets[i];
  }
  return null;
}

// Returns { rows: [...] } when safe to push, or { problem: "..." } when not.
function readPricingRows() {
  var sheet = pricingFindSheet();
  if (!sheet) return { problem: "sheet not found: " + PRICING_SHEET_NAME };

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < PRICING_HEADER_ROW || lastColumn < 1) return { problem: "header row is empty in: " + PRICING_SHEET_NAME };

  var headers = sheet.getRange(PRICING_HEADER_ROW, 1, 1, lastColumn).getValues()[0];
  var present = {};
  headers.forEach(function (header) {
    present[pricingNormalizeName(header)] = true;
  });
  var missing = PRICING_REQUIRED_HEADERS.filter(function (header) {
    return !present[pricingNormalizeName(header)];
  });
  if (missing.length > 0) {
    return { problem: "missing required header(s) " + JSON.stringify(missing) + " in: " + PRICING_SHEET_NAME };
  }

  var dataStartRow = PRICING_HEADER_ROW + 1;
  if (lastRow < dataStartRow) return { rows: [] };

  var values = sheet.getRange(dataStartRow, 1, lastRow - PRICING_HEADER_ROW, lastColumn).getValues();
  var keyColumn = -1;
  headers.forEach(function (header, colIndex) {
    if (keyColumn === -1 && pricingNormalizeName(header) === pricingNormalizeName(PRICING_KEY_HEADER)) keyColumn = colIndex;
  });

  var rows = [];
  values.forEach(function (rowValues, i) {
    if (pricingIsBlank(rowValues[keyColumn])) return;

    var data = {};
    var keyByName = {};
    headers.forEach(function (header, colIndex) {
      var label = String(header).replace(/\s+/g, " ").trim();
      if (!label) return;
      var name = pricingNormalizeName(label);
      var value = rowValues[colIndex];
      if (keyByName[name] === undefined) {
        keyByName[name] = label;
        data[label] = value;
      } else if (pricingIsBlank(data[keyByName[name]]) && !pricingIsBlank(value)) {
        data[keyByName[name]] = value;
      }
    });
    rows.push({ rowIndex: i + dataStartRow, hash: pricingComputeRowHash(rowValues), data: data });
  });
  return { rows: rows };
}

function pushPricingPayload(rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");
  if (!url || !secret) {
    var unset = "sku_pricing -> SYNC_WEBHOOK_URL or SYNC_SECRET script property is not set";
    Logger.log("ERROR: " + unset);
    pricingRecordSyncError(unset);
    return null;
  }

  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Sync-Secret": secret },
    payload: JSON.stringify({ tab: PRICING_TAB, rows: rows }),
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code < 200 || code >= 300) {
      var detail = "sku_pricing -> HTTP " + code + " (attempt " + attempt + "/3): " + response.getContentText().slice(0, 300);
      Logger.log("ERROR: " + detail);
      pricingRecordSyncError(detail);
    }

    if (code < 500) return response;
    Utilities.sleep(2000 * attempt);
  }

  var exhausted = "sku_pricing -> push failed after 3 attempts (5xx)";
  Logger.log("ERROR: " + exhausted);
  pricingRecordSyncError(exhausted);
  return null;
}

function syncPricing() {
  var result = readPricingRows();
  if (result.problem) {
    Logger.log("ERROR: sku_pricing not pushed, " + result.problem);
    pricingRecordSyncError("sku_pricing not pushed, " + result.problem);
    return;
  }
  pushPricingPayload(result.rows);
}

function manualTestPricingSync() {
  var result = readPricingRows();
  if (result.problem) {
    Logger.log("ERROR: " + result.problem);
    return;
  }
  Logger.log(result.rows.length + " rows. First 3:");
  Logger.log(JSON.stringify(result.rows.slice(0, 3), null, 2));
}

function createPricingTimeTrigger() {
  ScriptApp.newTrigger("syncPricing").timeBased().everyMinutes(30).create();
}
