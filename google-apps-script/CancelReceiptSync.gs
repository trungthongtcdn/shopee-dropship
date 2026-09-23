// Third script file in the same Apps Script project as PricingSync.gs —
// bound to "MII dữ liệu đối soát Luân up" (Editor access already granted
// there), reading its "ĐƠN HUỶ" tab. Row-1 header (same convention as
// THÔNG TIN HÀNG HOÁ), data from row 2.
//
// Column A ("Ngày nhận đơn huỷ") is pre-filled with a running calendar of
// dates as a template — a row only represents a real event once column B
// ("Mã vận đơn") is filled in by hand, so rows with an empty tracking code
// are skipped, not sent. Backend matches Order rows by trackingCode (not
// shopeeOrderId) and patches cancelReceivedAt/defectRate/cancelReceiptStatus
// — see applyCancelReceiptPayload in lib/sync/apply.ts.

var CANCEL_RECEIPT_SHEET_NAME = "ĐƠN HUỶ";
var CANCEL_RECEIPT_TAB = "cancel_receipt";

function cancelReceiptComputeRowHash(values) {
  var raw = values.join("|");
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest
    .map(function (byte) {
      var v = (byte + 256) % 256;
      return v.toString(16).padStart(2, "0");
    })
    .join("");
}

function cancelReceiptRecordSyncError(message) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("last_error", String(message).slice(0, 500));
  props.setProperty("last_error_at", new Date().toISOString());
}

function readCancelReceiptRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CANCEL_RECEIPT_SHEET_NAME);
  if (!sheet) {
    Logger.log("WARNING: sheet not found: " + CANCEL_RECEIPT_SHEET_NAME);
    return [];
  }

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 2) return [];

  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var trackingCodeCol = headers.indexOf("MÃ VẬN ĐƠN");
  if (trackingCodeCol === -1) {
    Logger.log("WARNING: 'MÃ VẬN ĐƠN' column not found, aborting");
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  var rows = [];
  values.forEach(function (rowValues, i) {
    var trackingCode = String(rowValues[trackingCodeCol] || "").trim();
    if (!trackingCode) return; // calendar template row, nothing filled in yet

    var data = {};
    headers.forEach(function (header, colIndex) {
      if (header) data[header] = rowValues[colIndex];
    });
    rows.push({ rowIndex: i + 2, hash: cancelReceiptComputeRowHash(rowValues), data: data });
  });

  return rows;
}

function pushCancelReceiptPayload(rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");

  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Sync-Secret": secret },
    payload: JSON.stringify({ tab: CANCEL_RECEIPT_TAB, rows: rows }),
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code < 200 || code >= 300) {
      var detail = "cancel_receipt -> HTTP " + code + " (attempt " + attempt + "/3): " + response.getContentText().slice(0, 300);
      Logger.log("ERROR: " + detail);
      cancelReceiptRecordSyncError(detail);
    }

    if (code < 500) return response;
    Utilities.sleep(2000 * attempt);
  }

  var exhausted = "cancel_receipt -> push failed after 3 attempts (5xx)";
  Logger.log("ERROR: " + exhausted);
  cancelReceiptRecordSyncError(exhausted);
  return null;
}

function syncCancelReceipt() {
  var rows = readCancelReceiptRows();
  pushCancelReceiptPayload(rows);
}

function manualTestCancelReceiptSync() {
  var rows = readCancelReceiptRows();
  Logger.log("Found " + rows.length + " filled-in rows. First 3:");
  Logger.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

function createCancelReceiptTimeTrigger() {
  ScriptApp.newTrigger("syncCancelReceipt").timeBased().everyMinutes(30).create();
}
