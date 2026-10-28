// Third script file, ADDED to the same Apps Script project as PricingSync.gs
// (bound to "MII dữ liệu đối soát Luân up" — already Editor access there).
// It reads a THIRD, separate spreadsheet — the weekly Shopee settlement
// report file ("[MII-Furniture]- PAYMENT-...") — by URL, not by container
// binding, because access there is Viewer-only: SpreadsheetApp.openByUrl
// only needs read access, unlike creating/running a script bound to that
// file, which would need Editor.
//
// (Shop 2's payment file is editable, so there this script is installed in the
// payment file itself and PAYMENT_SHEET_URL is left unset — see
// paymentOpenSpreadsheet below.)
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

// The payment file: the one at PAYMENT_SHEET_URL when that script property is set
// (shop 1, where the file is view-only and this script lives in another workbook),
// otherwise the spreadsheet this script is bound to (shop 2, where the file is
// editable and the script is installed in it directly).
function paymentOpenSpreadsheet() {
  var url = PropertiesService.getScriptProperties().getProperty("PAYMENT_SHEET_URL");
  if (url) return SpreadsheetApp.openByUrl(url);

  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    paymentReportProblem("PAYMENT_SHEET_URL script property is not set and this script is not bound to a spreadsheet");
  }
  return active;
}

// A problem that means nothing should be pushed: logged, and kept in the
// `last_error` script property so a trigger that fails every cycle is visible.
function paymentReportProblem(message) {
  Logger.log("ERROR: " + message);
  paymentRecordSyncError(message);
}

// Called when none of the spreadsheet's tabs has the payment layout — in practice
// the script was pasted into the wrong Google file.
function paymentReportWrongFile(ss) {
  paymentReportProblem(
    'no tab with the payment layout (header row ' + PAYMENT_HEADER_ROW + ': "Mã đơn hàng", "Mã sản phẩm", "Giá trị còn lại"; data from row ' +
      PAYMENT_DATA_START_ROW + ') in "' + ss.getName() + '". Install this script in the payment file itself (Extensions > Apps Script there), or set PAYMENT_SHEET_URL to it.'
  );
}

// Sums "Giá trị còn lại" per (Mã đơn hàng, Mã sản phẩm) pair across every
// weekly tab in the payment file — a multi-line order gets one row PER
// LINE here, never combined across different SKUs.
// Returns null (nothing to push) when the file could not be read as a payment file.
function readPaymentRows() {
  var ss = paymentOpenSpreadsheet();
  if (!ss) return null;

  var sheets = ss.getSheets();
  var totals = {}; // key: orderId + "::" + sku
  var paymentTabs = 0;

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
    paymentTabs += 1;

    var weekEndDate = paymentParseWeekEndDate(sheet.getName());

    var values = sheet.getRange(PAYMENT_DATA_START_ROW, 1, lastRow - PAYMENT_DATA_START_ROW + 1, lastColumn).getValues();
    values.forEach(function (rowValues) {
      var orderId = String(rowValues[orderIdCol] || "").trim();
      // "Mã sản phẩm" in this file is "itemId_modelId" (e.g.
      // "46662131156_351051228328"); Product.sku only stores the modelId
      // half (e.g. "351051228328") — take the part after the last "_" so
      // this matches the same identifier the Report page's "SKU" column
      // and PricingSync.gs's Product rows use.
      var rawSku = String(rowValues[skuCol] || "").trim();
      var sku = rawSku.indexOf("_") !== -1 ? rawSku.slice(rawSku.lastIndexOf("_") + 1) : rawSku;
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

  if (paymentTabs === 0) {
    paymentReportWrongFile(ss);
    return null;
  }

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
  if (!url || !secret) {
    paymentReportProblem("payment -> SYNC_WEBHOOK_URL or SYNC_SECRET script property is not set (Project Settings > Script Properties of THIS project)");
    return null;
  }

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
  if (rows === null) return;
  pushPaymentPayload(rows);
}

function manualTestPaymentSync() {
  var rows = readPaymentRows();
  if (rows === null) return;
  Logger.log("Aggregated " + rows.length + " (order, sku) pairs. First 3:");
  Logger.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

function createPaymentTimeTrigger() {
  ScriptApp.newTrigger("syncPayment").timeBased().everyMinutes(30).create();
}

// Raw per-line rows, grouped by week tab — separate from readPaymentRows'
// cross-week aggregate above. Backs the Reconciliation page's per-batch
// (per-week) order detail view, keyed by the same names as the sheet's tabs.
// Returns null (nothing to push) when the file could not be read as a payment file.
function readPaymentBatches() {
  var ss = paymentOpenSpreadsheet();
  if (!ss) return null;

  var sheets = ss.getSheets();
  var batches = [];
  var paymentTabs = 0;

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
    paymentTabs += 1;

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

  if (paymentTabs === 0) {
    paymentReportWrongFile(ss);
    return null;
  }

  return batches;
}

function pushPaymentBatchPayload(weekLabel, rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");
  if (!url || !secret) {
    paymentReportProblem("payment_batch -> SYNC_WEBHOOK_URL or SYNC_SECRET script property is not set (Project Settings > Script Properties of THIS project)");
    return null;
  }

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
  if (batches === null) return;
  batches.forEach(function (batch) {
    pushPaymentBatchPayload(batch.weekLabel, batch.rows);
  });
}

function manualTestPaymentBatches() {
  var batches = readPaymentBatches();
  if (batches === null) return;
  Logger.log("Found " + batches.length + " weekly batches.");
  if (batches.length > 0) {
    Logger.log(batches[0].weekLabel + ": " + batches[0].rows.length + " rows. First row:");
    Logger.log(JSON.stringify(batches[0].rows[0], null, 2));
  }
}

function createPaymentBatchTimeTrigger() {
  ScriptApp.newTrigger("syncPaymentBatches").timeBased().everyMinutes(30).create();
}
