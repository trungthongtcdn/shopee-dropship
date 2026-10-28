// Shop 2 order workbook ("VN_VŨ THỊ THẢO TRANG_MII") -> the same webhook and the
// same payload tabs as Sync.gs, which is shop 1's and is left as it is.
//
// What differs from shop 1's workbook, and so from Sync.gs:
//  - Different tabs: orders, cancellations, returns and the product list each live
//    on their own tab (see SHOP2_TABS). Shop 2 has no "đã giao" or "giao thất bại"
//    tab, so delivered_orders and delivery_failed are not synced.
//  - The product list is on tab 1 and its header is on row 1 (the other tabs have a
//    blank banner row, then the header on row 2). Tab 1 also carries ~900 padding
//    rows with a vendor name but no product, so rows without a key are dropped.
//  - The cancellation tab's real name ends with a space ("5.1Đơn hủy "); sheets are
//    found by name with surrounding space ignored.
//  - The returns tab calls two columns "Kho hàng" and "NCC ghi chú"; the server reads
//    "Tên kho hàng" and "NCC note", so those are sent under the server's names too.
//  - Dates are text like "2026-10-10 23:13" (Vietnam time). They are sent as ISO
//    instants with a +07:00 offset so the server's own timezone cannot shift them.
//
// Columns are found by header NAME, never by position. A tab is pushed only when
// every header in `required` is there: a payload is the tab's COMPLETE current
// state and the server soft-deletes whatever it omits, so pushing from a sheet that
// has lost or renamed a key column would delete rows. Missing headers are logged
// (View > Logs) and stored in the `last_error` script property instead.

var SHOP2_TABS = [
  {
    name: "orders",
    sheetName: "4. Danh sách đơn hàng",
    headerRow: 2,
    keyHeader: "Mã đơn hàng",
    required: ["Mã đơn hàng", "Tên phân loại hàng", "Trạng Thái Đơn Hàng", "Mã vận đơn"],
    optional: [
      "Mã Kiện Hàng",
      "Ngày đặt hàng",
      "Đơn Vị Vận Chuyển",
      "Phương thức giao hàng",
      "Ngày giao hàng dự kiến",
      "Tên sản phẩm",
      "Số lượng",
    ],
    aliases: {},
  },
  {
    name: "cancelled",
    sheetName: "5.1Đơn hủy",
    headerRow: 2,
    keyHeader: "Mã đơn hàng",
    required: ["Mã đơn hàng", "Trạng Thái Đơn Hàng"],
    optional: [
      "Mã Kiện Hàng",
      "Ngày đặt hàng",
      "Lý do hủy",
      "Mã vận đơn",
      "Đơn Vị Vận Chuyển",
      "Ngày giao hàng dự kiến",
      "Thời gian giao hàng",
      "Ngày hủy thành công",
      "Tên sản phẩm",
      "Tên kho hàng",
      "Tên phân loại hàng",
      "Số lượng",
    ],
    aliases: { "NCC note": ["NCC ghi chú"] },
  },
  {
    name: "returned_refunded",
    sheetName: "5. Trả hàng hoàn tiền",
    headerRow: 2,
    keyHeader: "Mã đơn hàng",
    required: ["Mã đơn hàng"],
    optional: [
      "Mã số khiếu nại",
      "Ngày đặt hàng",
      "Người Mua",
      "Tên sản phẩm",
      "Phân loại hàng",
      "Đơn Giá",
      "Thời gian khiếu nại",
      "Trạng thái Trả hàng/Hoàn tiền",
      "Số lượng Hoàn",
      "Lí do Trả hàng/Hoàn tiền",
      "Tổng số tiền Hoàn trả",
      "Thời gian hoàn tiền",
      "Mã vận đơn trả hàng",
      "Trạng thái trả hàng",
      "Người Bán cần phản hồi trước",
      "Lí Do Khiếu Nại",
      "Mã vận đơn giao hàng",
      "Tổng Giá Trị",
      "Trạng thái xử lý khiếu nại",
    ],
    aliases: { "Tên kho hàng": ["Kho hàng"], "NCC note": ["NCC ghi chú"] },
  },
  {
    name: "products",
    sheetName: "1. Danh sách sản phẩm",
    headerRow: 1,
    keyHeader: "MII - Mã phân loại",
    required: ["MII - Mã phân loại", "Tên sản phẩm", "Tên phân loại", "Giá nhập chưa VAT"],
    optional: ["MII - Mã sản phẩm"],
    aliases: {},
  },
];

// The sheet's own times are Vietnam time.
var SHOP2_UTC_OFFSET = "+07:00";
var SHOP2_DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

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

// Header / sheet-name comparison: case, accents form and runs of spaces do not matter.
function normalizeName(value) {
  return String(value).replace(/\s+/g, " ").trim().normalize("NFC").toLowerCase();
}

function isBlank(value) {
  return value === "" || value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function findSheet(sheetName) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var exact = spreadsheet.getSheetByName(sheetName);
  if (exact) return exact;

  var wanted = normalizeName(sheetName);
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (normalizeName(sheets[i].getName()) === wanted) return sheets[i];
  }
  return null;
}

// "2026-10-10 23:13" -> "2026-10-10T23:13:00+07:00". Anything else is returned as it is.
function normalizeCell(value) {
  if (typeof value !== "string") return value;
  var match = SHOP2_DATE_TEXT.exec(value.trim());
  if (!match) return value;
  var hour = ("0" + (match[4] || "0")).slice(-2);
  var minute = match[5] || "00";
  var second = match[6] || "00";
  return match[1] + "-" + match[2] + "-" + match[3] + "T" + hour + ":" + minute + ":" + second + SHOP2_UTC_OFFSET;
}

// One object per row, keyed by header text. A header that appears twice keeps the
// first value that is not empty. `aliases` fills the server's column name from the
// sheet's own name for it when the server's name is absent or empty.
function buildRowData(headers, rowValues, aliases) {
  var data = {};
  var keyByName = {};

  headers.forEach(function (header, colIndex) {
    var label = String(header).replace(/\s+/g, " ").trim();
    if (!label) return;
    var name = normalizeName(label);
    var value = normalizeCell(rowValues[colIndex]);
    if (keyByName[name] === undefined) {
      keyByName[name] = label;
      data[label] = value;
    } else if (isBlank(data[keyByName[name]]) && !isBlank(value)) {
      data[keyByName[name]] = value;
    }
  });

  Object.keys(aliases).forEach(function (target) {
    var targetKey = keyByName[normalizeName(target)];
    if (targetKey !== undefined && !isBlank(data[targetKey])) return;
    aliases[target].some(function (source) {
      var sourceKey = keyByName[normalizeName(source)];
      if (sourceKey === undefined || isBlank(data[sourceKey])) return false;
      data[targetKey !== undefined ? targetKey : target] = data[sourceKey];
      return true;
    });
  });

  return data;
}

// Returns { rows: [...] } when the tab is safe to push, or { problem: "..." } when it
// is not — never a made-up empty list for a tab that could not be read.
function readTabRows(tab) {
  var sheet = findSheet(tab.sheetName);
  if (!sheet) return { problem: "sheet not found: " + tab.sheetName };

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < tab.headerRow || lastColumn < 1) {
    return { problem: "header row " + tab.headerRow + " is empty in: " + tab.sheetName };
  }

  var headers = sheet.getRange(tab.headerRow, 1, 1, lastColumn).getValues()[0];
  var present = {};
  headers.forEach(function (header) {
    present[normalizeName(header)] = true;
  });

  var missingRequired = tab.required.filter(function (header) {
    return !present[normalizeName(header)];
  });
  if (missingRequired.length > 0) {
    return { problem: "missing required header(s) " + JSON.stringify(missingRequired) + " in: " + tab.sheetName };
  }

  tab.optional.forEach(function (header) {
    if (!present[normalizeName(header)]) {
      Logger.log('WARNING: header "' + header + '" not found in "' + tab.sheetName + '", sending it empty');
    }
  });

  var dataStartRow = tab.headerRow + 1;
  if (lastRow < dataStartRow) return { rows: [] };

  var values = sheet.getRange(dataStartRow, 1, lastRow - tab.headerRow, lastColumn).getValues();
  var keyColumn = -1;
  headers.forEach(function (header, colIndex) {
    if (keyColumn === -1 && normalizeName(header) === normalizeName(tab.keyHeader)) keyColumn = colIndex;
  });

  var rows = [];
  values.forEach(function (rowValues, i) {
    // Padding / half-filled rows have no key; the server could not store them anyway.
    if (isBlank(rowValues[keyColumn])) return;
    rows.push({
      rowIndex: i + dataStartRow,
      hash: computeRowHash(rowValues),
      data: buildRowData(headers, rowValues, tab.aliases),
    });
  });
  return { rows: rows };
}

function pushPayload(tab, rows) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("SYNC_WEBHOOK_URL");
  var secret = props.getProperty("SYNC_SECRET");
  if (!url || !secret) {
    var unset = "tab " + tab + " -> SYNC_WEBHOOK_URL or SYNC_SECRET script property is not set";
    Logger.log("ERROR: " + unset);
    recordSyncError(unset);
    return null;
  }

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

    // Any non-2xx is a real failure worth surfacing: a 401 (wrong secret) or 400
    // (bad payload) would otherwise be discarded and the sync would look healthy.
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
  SHOP2_TABS.forEach(function (tab) {
    var result = readTabRows(tab);
    if (result.problem) {
      Logger.log("ERROR: tab " + tab.name + " not pushed, " + result.problem);
      recordSyncError("tab " + tab.name + " not pushed, " + result.problem);
      return;
    }
    pushPayload(tab.name, result.rows);
  });
}

// Read-only: first 3 order rows, no webhook call.
function manualTestSync() {
  var result = readTabRows(SHOP2_TABS[0]);
  if (result.problem) {
    Logger.log("ERROR: " + result.problem);
    return;
  }
  Logger.log(JSON.stringify(result.rows.slice(0, 3), null, 2));
}

// Read-only check across every tab in one run: row count + first 2 rows per tab,
// no webhook call. Run this first to verify the header mapping before syncAllTabs.
function manualTestAllTabs() {
  SHOP2_TABS.forEach(function (tab) {
    var result = readTabRows(tab);
    if (result.problem) {
      Logger.log("ERROR: " + tab.name + " not readable, " + result.problem);
      return;
    }
    Logger.log("=== " + tab.name + ' ("' + tab.sheetName + '") — ' + result.rows.length + " rows ===");
    Logger.log(JSON.stringify(result.rows.slice(0, 2), null, 2));
  });
}

function createTimeTrigger() {
  ScriptApp.newTrigger("syncAllTabs").timeBased().everyMinutes(10).create();
}
