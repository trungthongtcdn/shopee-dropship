// Fills "Không cần nhận" into the receipt column of every return/refund row the buyer
// withdrew. Works for both shops: the same file is pasted into the Apps Script project of
// each order workbook (shop 1 "[MII_Furniture]_WH049_TTRANG", shop 2 "VN_VŨ THỊ THẢO TRANG_MII").
//
// The rule: on a row whose "Trạng thái Trả hàng/Hoàn tiền" reads "Yêu cầu của Người mua đã
// hủy" the buyer cancelled the return, nothing comes back, so
// "Trạng thái nhận/Check Dup" is set to "Không cần nhận".
//
// How it behaves, so nobody has to remember it:
//  - Columns are found by header NAME (never by letter), on every tab that has the status
//    header in its first rows — no tab names are hard-coded, so shop 1's
//    "5. Trả hàng/hoàn tiền" and shop 2's "5. Trả hàng hoàn tiền" are both covered.
//  - The status is compared without case, tone marks or extra spaces, so "hủy" / "huỷ"
//    both count.
//  - Only an EMPTY cell is filled. A value somebody typed (or a formula) is never
//    overwritten, and a status changed later does not clear what was filled.
//  - A tab that has no "Trạng thái nhận/Check Dup" column gets one, at the end of its header
//    row (formatted like the header cell before it). NR_EXTRA_COLUMNS lists any other columns
//    to add the same way.
//  - Nothing is ever deleted, and no row is touched except that one cell.
//  - It does not touch Sync.gs / Sync.shop2.gs: the sync reads columns by header name, so a
//    new column at the end is simply one more header it does not use.
//
// Deploy (once per workbook): Extensions > Apps Script > add a new file, paste this one, run
// `manualTestNoReceipt` (writes nothing, logs what it would fill), run `fillNoReceiptNeeded`,
// then `createNoReceiptTrigger` (every 10 minutes). No Script Properties are needed.

var NR_STATUS_HEADER = "Trạng thái Trả hàng/Hoàn tiền";
var NR_RECEIPT_HEADER = "Trạng thái nhận/Check Dup";
var NR_BUYER_CANCELLED = "Yêu cầu của Người mua đã hủy";
var NR_VALUE = "Không cần nhận";
// Other headers to make sure exist, at the end of the header row, on every tab that has the
// status header. Left empty: add the names here, e.g. ["Ngày nhận", "Người nhận"].
var NR_EXTRA_COLUMNS = [];
// The header row sits under a banner row; look this many rows down for it.
var NR_HEADER_SCAN_ROWS = 5;
var NR_RANGELIST_CHUNK = 400;

// Header comparison: case and any whitespace do not matter ("Trạng thái nhận / Check Dup").
function nrHeaderKey(text) {
  return String(text === null || text === undefined ? "" : text)
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, "");
}

// Status comparison: also ignores tone marks, so "hủy" and "huỷ" (two spellings of one word)
// and stray spaces in the cell all match.
function nrStatusKey(text) {
  return String(text === null || text === undefined ? "" : text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function nrReportError(message) {
  Logger.log("ERROR: " + message);
  var props = PropertiesService.getScriptProperties();
  props.setProperty("no_receipt_last_error", String(message).slice(0, 500));
  props.setProperty("no_receipt_last_error_at", new Date().toISOString());
}

// 1-based column of the header, or 0.
function nrFindColumn(headers, name) {
  var wanted = nrHeaderKey(name);
  for (var i = 0; i < headers.length; i++) {
    if (nrHeaderKey(headers[i]) === wanted) return i + 1;
  }
  return 0;
}

// Adds the header at the end of the header row and returns its 1-based column. `headers` is
// kept in step so a later lookup sees the new column.
function nrAddColumn(sheet, headerRow, headers, name) {
  var last = headers.length;
  if (last >= sheet.getMaxColumns()) sheet.insertColumnAfter(last);
  var target = sheet.getRange(headerRow, last + 1);
  if (last > 0) sheet.getRange(headerRow, last).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  target.setValue(name);
  headers.push(name);
  Logger.log('"' + sheet.getName() + '": added column "' + name + '" at column ' + (last + 1));
  return last + 1;
}

// Handles one tab. Returns null when the tab is not a return/refund tab (no status header),
// otherwise how many cells were filled (or would be, when `dryRun`).
function nrProcessSheet(sheet, dryRun) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) return null;

  var top = sheet.getRange(1, 1, Math.min(NR_HEADER_SCAN_ROWS, lastRow), lastColumn).getValues();
  var headerRow = 0;
  var statusColumn = 0;
  for (var r = 0; r < top.length && !headerRow; r++) {
    var found = nrFindColumn(top[r], NR_STATUS_HEADER);
    if (found) {
      headerRow = r + 1;
      statusColumn = found;
    }
  }
  if (!headerRow) return null;

  var headers = top[headerRow - 1].slice();
  var receiptColumn = nrFindColumn(headers, NR_RECEIPT_HEADER);

  if (!dryRun) {
    if (!receiptColumn) receiptColumn = nrAddColumn(sheet, headerRow, headers, NR_RECEIPT_HEADER);
    NR_EXTRA_COLUMNS.forEach(function (name) {
      if (!nrFindColumn(headers, name)) nrAddColumn(sheet, headerRow, headers, name);
    });
  }

  var dataRows = lastRow - headerRow;
  if (dataRows < 1) return 0;

  // An ARRAYFORMULA in the column fills it by itself; writing into the cells it spreads over
  // would break it, so such a column is left alone.
  var receiptValues = [];
  var receiptFormulas = [];
  if (receiptColumn) {
    var headerFormula = sheet.getRange(headerRow, receiptColumn).getFormula();
    var firstFormula = sheet.getRange(headerRow + 1, receiptColumn).getFormula();
    if (/arrayformula/i.test(headerFormula) || /arrayformula/i.test(firstFormula)) {
      Logger.log('"' + sheet.getName() + '": "' + NR_RECEIPT_HEADER + '" is an array formula - left alone');
      return 0;
    }
    var receiptRange = sheet.getRange(headerRow + 1, receiptColumn, dataRows, 1);
    receiptValues = receiptRange.getValues();
    receiptFormulas = receiptRange.getFormulas();
  }

  var statuses = sheet.getRange(headerRow + 1, statusColumn, dataRows, 1).getValues();
  var wanted = nrStatusKey(NR_BUYER_CANCELLED);
  var rows = [];
  for (var i = 0; i < dataRows; i++) {
    if (nrStatusKey(statuses[i][0]) !== wanted) continue;
    var typed = receiptColumn ? String(receiptValues[i][0]).trim() : "";
    var formula = receiptColumn ? receiptFormulas[i][0] : "";
    if (typed === "" && formula === "") rows.push(headerRow + 1 + i);
  }

  if (!dryRun && rows.length > 0) {
    var letter = sheet.getRange(1, receiptColumn).getA1Notation().replace(/\d+/g, "");
    for (var start = 0; start < rows.length; start += NR_RANGELIST_CHUNK) {
      var cells = rows.slice(start, start + NR_RANGELIST_CHUNK).map(function (row) {
        return letter + row;
      });
      sheet.getRangeList(cells).setValue(NR_VALUE);
    }
  }
  return rows.length;
}

function nrRun(dryRun) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("fillNoReceiptNeeded: another run is in progress, skipped");
    return;
  }
  try {
    var filled = 0;
    var tabs = 0;
    SpreadsheetApp.getActiveSpreadsheet()
      .getSheets()
      .forEach(function (sheet) {
        try {
          var count = nrProcessSheet(sheet, dryRun);
          if (count === null) return;
          tabs += 1;
          filled += count;
          Logger.log('"' + sheet.getName() + '": ' + count + " ô " + (dryRun ? "sẽ điền" : "đã điền"));
        } catch (error) {
          nrReportError('tab "' + sheet.getName() + '": ' + error);
        }
      });
    if (tabs === 0) {
      Logger.log('WARNING: không thấy tab nào có cột "' + NR_STATUS_HEADER + '" - không làm gì');
    }
    Logger.log("fillNoReceiptNeeded" + (dryRun ? " (chạy thử, không ghi)" : "") + ": " + filled + " ô, " + tabs + " tab");
  } finally {
    lock.releaseLock();
  }
}

// The one the trigger runs.
function fillNoReceiptNeeded() {
  nrRun(false);
}

// Writes nothing and adds no column: logs how many cells each tab would get.
function manualTestNoReceipt() {
  nrRun(true);
}

function createNoReceiptTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === "fillNoReceiptNeeded") ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger("fillNoReceiptNeeded").timeBased().everyMinutes(10).create();
}
