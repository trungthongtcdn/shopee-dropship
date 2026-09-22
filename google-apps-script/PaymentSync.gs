// Third script file, ADDED to the same Apps Script project as PricingSync.gs
// (bound to "MII dữ liệu đối soát Luân up" — already Editor access there).
// It reads a THIRD, separate spreadsheet — the weekly Shopee settlement
// report file ("[MII-Furniture]- PAYMENT-...") — by URL, not by container
// binding, because access there is Viewer-only: SpreadsheetApp.openByUrl
// only needs read access, unlike creating/running a script bound to that
// file, which would need Editor.
//
// That file has one tab PER WEEK (tab name is the date range, e.g.
// "07/09/2026-13/09/2026"), each with the same layout: a few header rows,
// then a real header row at row 8 ("Tháng | Kỳ thanh toán | Mã đơn hàng |
// Mã sản phẩm | ... | Giá trị còn lại"), data from row 9. Each row is one
// product LINE within an order, not one row per order — so this script sums
// "Giá trị còn lại" (net amount after service fee + tax deduction) per "Mã
// đơn hàng", across every tab in the file, before sending. The backend's
// applyPaymentPayload (tab "payment") expects one row per order.

var PAYMENT_HEADER_ROW = 8;
var PAYMENT_DATA_START_ROW = 9;
var PAYMENT_TAB = "payment";

function paymentComputeRowHash(values) {
  var raw = values.join("|");
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest
    .map(function (byte) {
      var v = (byte + 256) % 256;
      return v.toString(16).padStart(2, "0");
    })
    .join("");
}

function paymentRecordSyncError(message) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("last_error", String(message).slice(0, 500));
  props.setProperty("last_error_at", new Date().toISOString());
}

// Sums "Giá trị còn lại" per "Mã đơn hàng" across every weekly tab in the
// payment file, returning one aggregated row per order.
function readPaymentRows() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("PAYMENT_SHEET_URL");
  if (!url) {
    Logger.log("WARNING: PAYMENT_SHEET_URL script property not set");
    return [];
  }

  var ss = SpreadsheetApp.openByUrl(url);
  var sheets = ss.getSheets();
  var totalsByOrderId = {};

  sheets.forEach(function (sheet) {
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < PAYMENT_DATA_START_ROW) return;

    var headers = sheet.getRange(PAYMENT_HEADER_ROW, 1, 1, lastColumn).getValues()[0];
    var orderIdCol = headers.indexOf("Mã đơn hàng");
    var amountCol = headers.indexOf("Giá trị còn lại");
    if (orderIdCol === -1 || amountCol === -1) {
      Logger.log("WARNING: skipping tab (unexpected header layout): " + sheet.getName());
      return;
    }

    var values = sheet.getRange(PAYMENT_DATA_START_ROW, 1, lastRow - PAYMENT_DATA_START_ROW + 1, lastColumn).getValues();
    values.forEach(function (rowValues) {
      var orderId = String(rowValues[orderIdCol] || "").trim();
      var amount = Number(rowValues[amountCol]);
      if (!orderId || isNaN(amount)) return;
      totalsByOrderId[orderId] = (totalsByOrderId[orderId] || 0) + amount;
    });
  });

  var rows = [];
  var index = 0;
  for (var orderId in totalsByOrderId) {
    index += 1;
    var amount = totalsByOrderId[orderId];
    rows.push({
      rowIndex: index,
      hash: paymentComputeRowHash([orderId, amount]),
      data: { "Mã đơn hàng": orderId, "Giá trị còn lại": amount },
    });
  }
  return rows;
}

function pushPaymentPayload(rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");

  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Sync-Secret": secret },
    payload: JSON.stringify({ tab: PAYMENT_TAB, rows: rows }),
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code < 200 || code >= 300) {
      var detail = "payment -> HTTP " + code + " (attempt " + attempt + "/3): " + response.getContentText().slice(0, 300);
      Logger.log("ERROR: " + detail);
      paymentRecordSyncError(detail);
    }

    if (code < 500) return response;
    Utilities.sleep(2000 * attempt);
  }

  var exhausted = "payment -> push failed after 3 attempts (5xx)";
  Logger.log("ERROR: " + exhausted);
  paymentRecordSyncError(exhausted);
  return null;
}

function syncPayment() {
  var rows = readPaymentRows();
  pushPaymentPayload(rows);
}

function manualTestPaymentSync() {
  var rows = readPaymentRows();
  Logger.log("Aggregated " + rows.length + " orders. First 3:");
  Logger.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

function createPaymentTimeTrigger() {
  ScriptApp.newTrigger("syncPayment").timeBased().everyMinutes(30).create();
}
