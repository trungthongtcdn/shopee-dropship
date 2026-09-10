var TABS = [
  { name: "orders", sheetName: "Orders" },
  { name: "cancellations", sheetName: "Cancellations" },
  { name: "products", sheetName: "Products" },
];

function computeRowHash(values) {
  var raw = values.join("|");
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return digest
    .map(function (byte) {
      var v = (byte + 256) % 256;
      return v.toString(16).padStart(2, "0");
    })
    .join("");
}

function recordSyncError(message) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("last_error", String(message).slice(0, 500));
  props.setProperty("last_error_at", new Date().toISOString());
}

function getTabSheet(sheetName) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}

function readTabRows(sheetName) {
  var sheet = getTabSheet(sheetName);
  if (!sheet) {
    Logger.log("WARNING: sheet not found, returning no rows for: " + sheetName);
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
    return { rowIndex: i + 2, hash: computeRowHash(rowValues), data: data };
  });
}

function pushPayload(tab, rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");

  var options = {
    method: "post",
    contentType: "application/json",
    headers: { "X-Sync-Secret": secret },
    payload: JSON.stringify({ tab: tab, rows: rows }),
    muteHttpExceptions: true,
  };

  for (var attempt = 1; attempt <= 3; attempt++) {
    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    // Any non-2xx is a real failure worth surfacing, not just an exhausted 5xx
    // retry: a 401 (wrong secret) or 400 (bad payload) would otherwise be
    // silently discarded and the sync would look healthy while doing nothing.
    if (code < 200 || code >= 300) {
      var detail =
        "tab " + tab + " -> HTTP " + code + " (attempt " + attempt + "/3): " + response.getContentText().slice(0, 300);
      Logger.log("ERROR: sync push failed, " + detail);
      recordSyncError(detail);
    }

    // 4xx will not fix itself on retry; only 5xx is retried.
    if (code < 500) return response;
    Utilities.sleep(2000 * attempt);
  }

  var exhausted = "tab " + tab + " -> push failed after 3 attempts (5xx)";
  Logger.log("ERROR: " + exhausted);
  recordSyncError(exhausted);
  return null;
}

function syncAllTabs() {
  TABS.forEach(function (tab) {
    // The webhook treats "active row absent from the payload" as deleted, so
    // every payload must be the COMPLETE current state of its tab. Never split
    // a tab across requests, and never push an empty payload for a sheet that
    // is merely missing - either would soft-delete the whole tab.
    if (!getTabSheet(tab.sheetName)) {
      Logger.log("WARNING: sheet not found, skipping tab: " + tab.sheetName);
      recordSyncError("sheet not found, skipped tab: " + tab.sheetName);
      return;
    }

    var rows = readTabRows(tab.sheetName);
    pushPayload(tab.name, rows);
  });
}

function manualTestSync() {
  var rows = readTabRows("Orders");
  Logger.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

function createTimeTrigger() {
  ScriptApp.newTrigger("syncAllTabs").timeBased().everyMinutes(10).create();
}
