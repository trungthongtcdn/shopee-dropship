var TABS = [
  { name: "orders", sheetName: "Orders" },
  { name: "cancellations", sheetName: "Cancellations" },
  { name: "products", sheetName: "Products" },
];

var BATCH_SIZE = 200;

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

function readTabRows(sheetName) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
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
    if (response.getResponseCode() < 500) return response;
    Utilities.sleep(2000 * attempt);
  }

  props.setProperty("last_error", "push failed for tab " + tab);
  props.setProperty("last_error_at", new Date().toISOString());
  return null;
}

function syncAllTabs() {
  TABS.forEach(function (tab) {
    var rows = readTabRows(tab.sheetName);
    for (var i = 0; i < rows.length; i += BATCH_SIZE) {
      pushPayload(tab.name, rows.slice(i, i + BATCH_SIZE));
    }
  });
}

function manualTestSync() {
  var rows = readTabRows("Orders");
  Logger.log(JSON.stringify(rows.slice(0, 3), null, 2));
}

function createTimeTrigger() {
  ScriptApp.newTrigger("syncAllTabs").timeBased().everyMinutes(10).create();
}
