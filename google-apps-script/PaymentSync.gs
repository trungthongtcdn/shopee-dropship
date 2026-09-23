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
// product LINE within an order (one "Mã sản phẩm" per line — same identifier
// as the Report page's "SKU" column) — so this script sums "Giá trị còn lại"
// per (Mã đơn hàng, Mã sản phẩm) PAIR across every weekly tab, NOT per order
// alone: summing every line of a multi-line order into one order-level
// total would make the backend compare a single line's amountDue against
// the whole order's amountPaid. The backend's applyPaymentPayload (tab
// "payment") expects one row per (order, sku).
//
// No column in the sheet is an explicit "payment date" — confirmed with
// Luân to use the END date of the tab's own date-range name instead (see
// paymentParseWeekEndDate), sent as "Ngày thanh toán". The backend patches
// this onto Order.paidAt (Report page's "Ngày thanh toán").

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

// The sheet has no per-row payment-date column — the tab name itself is the
// date range (e.g. "07/09/2026-13/09/2026"), confirmed with Luân to use the
// END date of that range as "Ngày thanh toán". Format is DD/MM/YYYY-DD/MM/YYYY.
function paymentParseWeekEndDate(tabName) {
  var parts = tabName.split("-");
  if (parts.length !== 2) return null;
  var endParts = parts[1].split("/");
  if (endParts.length !== 3) return null;
  var day = Number(endParts[0]);
  var month = Number(endParts[1]);
  var year = Number(endParts[2]);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month - 1, day);
}

// Sums "Giá trị còn lại" per (Mã đơn hàng, Mã sản phẩm) pair across every
// weekly tab in the payment file — a multi-line order gets one row PER
// LINE here, never combined across different SKUs.
function readPaymentRows() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("PAYMENT_SHEET_URL");
  if (!url) {
    Logger.log("WARNING: PAYMENT_SHEET_URL script property not set");
    return [];
  }

  var ss = SpreadsheetApp.openByUrl(url);
  var sheets = ss.getSheets();
  var totals = {}; // key: orderId + "::" + sku

  sheets.forEach(function (sheet) {
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < PAYMENT_DATA_START_ROW) return;

    var headers = sheet.getRange(PAYMENT_HEADER_ROW, 1, 1, lastColumn).getValues()[0];
    var orderIdCol = headers.indexOf("Mã đơn hàng");
    var skuCol = headers.indexOf("Mã sản phẩm");
    var amountCol = headers.indexOf("Giá trị còn lại");
    if (orderIdCol === -1 || skuCol === -1 || amountCol === -1) {
      Logger.log("WARNING: skipping tab (unexpected header layout): " + sheet.getName());
      return;
    }

    var weekEndDate = paymentParseWeekEndDate(sheet.getName());

    var values = sheet.getRange(PAYMENT_DATA_START_ROW, 1, lastRow - PAYMENT_DATA_START_ROW + 1, lastColumn).getValues();
    values.forEach(function (rowValues) {
      var orderId = String(rowValues[orderIdCol] || "").trim();
      var sku = String(rowValues[skuCol] || "").trim();
      var amount = Number(rowValues[amountCol]);
      if (!orderId || !sku || isNaN(amount)) return;

      var key = orderId + "::" + sku;
      if (!totals[key]) totals[key] = { orderId: orderId, sku: sku, amount: 0, paidAt: null };
      totals[key].amount += amount;
      // If the same (order, sku) pair appears in more than one weekly tab
      // (e.g. a correction), keep the most recent week's end date.
      if (weekEndDate && (!totals[key].paidAt || weekEndDate > totals[key].paidAt)) {
        totals[key].paidAt = weekEndDate;
      }
    });
  });

  var rows = [];
  var index = 0;
  for (var key in totals) {
    index += 1;
    var t = totals[key];
    var data = { "Mã đơn hàng": t.orderId, "Mã sản phẩm": t.sku, "Giá trị còn lại": t.amount };
    if (t.paidAt) data["Ngày thanh toán"] = t.paidAt.toISOString();
    rows.push({
      rowIndex: index,
      hash: paymentComputeRowHash([t.orderId, t.sku, t.amount, t.paidAt ? t.paidAt.toISOString() : ""]),
      data: data,
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
  Logger.log("Aggregated " + rows.length + " (order, sku) pairs. First 3:");
  Logger.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

function createPaymentTimeTrigger() {
  ScriptApp.newTrigger("syncPayment").timeBased().everyMinutes(30).create();
}

// Raw per-line rows, grouped by week tab — separate from readPaymentRows'
// cross-week aggregate above. Backs the Reconciliation page's per-batch
// (per-week) order detail view, keyed by the same names as the sheet's tabs.
function readPaymentBatches() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("PAYMENT_SHEET_URL");
  if (!url) {
    Logger.log("WARNING: PAYMENT_SHEET_URL script property not set");
    return [];
  }

  var ss = SpreadsheetApp.openByUrl(url);
  var sheets = ss.getSheets();
  var batches = [];

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
    var rows = [];
    values.forEach(function (rowValues, i) {
      var orderId = String(rowValues[orderIdCol] || "").trim();
      var amount = Number(rowValues[amountCol]);
      if (!orderId || isNaN(amount)) return;

      var data = {};
      headers.forEach(function (header, colIndex) {
        if (header) data[header] = rowValues[colIndex];
      });
      rows.push({
        rowIndex: PAYMENT_DATA_START_ROW + i,
        hash: paymentComputeRowHash(rowValues),
        data: data,
      });
    });

    if (rows.length > 0) {
      batches.push({ weekLabel: sheet.getName(), rows: rows });
    }
  });

  return batches;
}

function pushPaymentBatchPayload(weekLabel, rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");

  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Sync-Secret": secret },
    payload: JSON.stringify({ tab: "payment_batch", batchLabel: weekLabel, rows: rows }),
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code < 200 || code >= 300) {
      var detail = "payment_batch(" + weekLabel + ") -> HTTP " + code + " (attempt " + attempt + "/3): " + response.getContentText().slice(0, 300);
      Logger.log("ERROR: " + detail);
      paymentRecordSyncError(detail);
    }

    if (code < 500) return response;
    Utilities.sleep(2000 * attempt);
  }

  var exhausted = "payment_batch(" + weekLabel + ") -> push failed after 3 attempts (5xx)";
  Logger.log("ERROR: " + exhausted);
  paymentRecordSyncError(exhausted);
  return null;
}

function syncPaymentBatches() {
  var batches = readPaymentBatches();
  batches.forEach(function (batch) {
    pushPaymentBatchPayload(batch.weekLabel, batch.rows);
  });
}

function manualTestPaymentBatches() {
  var batches = readPaymentBatches();
  Logger.log("Found " + batches.length + " weekly batches.");
  if (batches.length > 0) {
    Logger.log(batches[0].weekLabel + ": " + batches[0].rows.length + " rows. First row:");
    Logger.log(JSON.stringify(batches[0].rows[0], null, 2));
  }
}

function createPaymentBatchTimeTrigger() {
  ScriptApp.newTrigger("syncPaymentBatches").timeBased().everyMinutes(30).create();
}
