// Bound to a DIFFERENT workbook than Sync.gs — "MII dữ liệu đối soát Luân up"
// (Luân's own SKU→price reference file, not Shopee's). Syncs only the
// "THÔNG TIN HÀNG HOÁ" tab, which uses a normal row-1 header (no "MII điền"
// banner row like the Shopee workbook), to the same backend under the
// "sku_pricing" tab, which only patches existing Product rows — see
// lib/sync/apply.ts's applySkuPricingPayload for why.

var PRICING_SHEET_NAME = "THÔNG TIN HÀNG HOÁ";
var PRICING_TAB = "sku_pricing";

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

function readPricingRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PRICING_SHEET_NAME);
  if (!sheet) {
    Logger.log("WARNING: sheet not found: " + PRICING_SHEET_NAME);
    return [];
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2) return [];

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  return values.map(function (rowValues, i) {
    var data = {};
    headers.forEach(function (header, colIndex) {
      data[header] = rowValues[colIndex];
    });
    return { rowIndex: i + 2, hash: pricingComputeRowHash(rowValues), data: data };
  });
}

function pushPricingPayload(rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");

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
  var rows = readPricingRows();
  pushPricingPayload(rows);
}

function manualTestPricingSync() {
  var rows = readPricingRows();
  Logger.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

function createPricingTimeTrigger() {
  ScriptApp.newTrigger("syncPricing").timeBased().everyMinutes(30).create();
}
