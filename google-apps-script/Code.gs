/**
 * MoneyFlow - Google Apps Script backend
 * - Syncs Transactions, Loans, Categories, Budgets, Goals to a Spreadsheet
 * - Endpoints (GET/POST): action = getAll | replaceAll | status
 *
 * To use:
 *  - Set SPREADSHEET_ID to a specific spreadsheet or leave blank to use the active spreadsheet.
 *  - Deploy as Web App (Execute as: Me / Who has access: Anyone with link).
 */

const SPREADSHEET_ID = ''; // set to a spreadsheet ID or leave empty to use active spreadsheet

// Table headers
const TRANSACTION_HEADERS = ['id','type','amount','date','category','note','loanId','loanType','createdAt'];
const LOAN_HEADERS = ['id','name','principal','remaining','date','note','createdAt'];
const CATEGORY_HEADERS = ['name','type','createdAt'];
const BUDGET_HEADERS = ['category','amount'];
const GOAL_HEADERS = ['name','target','saved'];

/* ---------- Utilities ---------- */

function ss() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function fingerprint(obj) {
  const raw = JSON.stringify(obj);
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8));
}

function formatDate(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v).slice(0,10);
}

/* ---------- Sheet helpers ---------- */

function sheet(name, headers) {
  const spreadsheet = ss();
  let sh = spreadsheet.getSheetByName(name);
  if (!sh) {
    sh = spreadsheet.insertSheet(name);
    if (headers && headers.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else {
    // Ensure headers exist and first row length matches headers
    try {
      const existing = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0] || [];
      if (!existing || existing.length < (headers ? headers.length : 0)) {
        if (headers && headers.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
        sh.setFrozenRows(1);
      }
    } catch (e) { /* ignore */ }
  }
  return sh;
}

function readRows(name, headers) {
  const sh = sheet(name, headers);
  const range = sh.getDataRange();
  const vals = range.getValues();
  if (!vals || vals.length < 2) return [];
  const data = [];
  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    // skip completely blank rows
    if (!row.some(cell => cell !== '' && cell !== null && typeof cell !== 'undefined')) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    data.push(obj);
  }
  return data;
}

/* ---------- Normalizers ---------- */

function normalizeTransaction(x) {
  if (!x) return null;
  return {
    id: String(x.id || ''),
    type: String(x.type || 'expense'),
    amount: Number(x.amount || 0),
    date: formatDate(x.date),
    category: String(x.category || 'General'),
    note: String(x.note || ''),
    loanId: x.hasOwnProperty('loanId') && x.loanId !== null ? String(x.loanId) : '',
    loanType: String(x.loanType || ''),
    createdAt: x.createdAt ? (new Date(x.createdAt)).toISOString() : (new Date()).toISOString()
  };
}

function normalizeLoan(x) {
  if (!x) return null;
  return {
    id: String(x.id || ''),
    name: String(x.name || ''),
    principal: Number(x.principal || 0),
    remaining: Number(x.remaining || 0),
    date: formatDate(x.date),
    note: String(x.note || ''),
    createdAt: x.createdAt ? (new Date(x.createdAt)).toISOString() : (new Date()).toISOString()
  };
}

function normalizeCategory(x) {
  if (!x) return null;
  return {
    name: String(x.name || '').trim(),
    type: String(x.type || 'expense'),
    createdAt: x.createdAt ? (new Date(x.createdAt)).toISOString() : (new Date()).toISOString()
  };
}

/* Merge unique categories (case-insensitive name + type) */
function uniqueCategories(xs) {
  const out = [];
  xs.forEach(x => {
    const c = normalizeCategory(x);
    if (!c || !c.name) return;
    const exists = out.some(y => y.name.toLowerCase() === c.name.toLowerCase() && y.type === c.type);
    if (!exists) out.push(c);
  });
  return out;
}

/* ---------- Read / Write all ---------- */

function readAll() {
  // Transactions
  const rawTx = readRows('Transactions', TRANSACTION_HEADERS);
  const transactions = rawTx.map(normalizeTransaction).filter(Boolean);

  // Loans
  const rawLoans = readRows('Loans', LOAN_HEADERS);
  const loans = rawLoans.map(normalizeLoan).filter(Boolean);

  // Categories
  const rawCats = readRows('Categories', CATEGORY_HEADERS);
  const categories = uniqueCategories(rawCats);

  // Budgets
  const rawBudgets = readRows('Budgets', BUDGET_HEADERS).map(r => {
    return { category: String(r.category || ''), amount: Number(r.amount || 0) };
  });

  // Goals
  const rawGoals = readRows('Goals', GOAL_HEADERS).map(r => {
    return { name: String(r.name || ''), target: Number(r.target || 0), saved: Number(r.saved || 0) };
  });

  const out = { transactions, loans, categories, budgets: rawBudgets, goals: rawGoals };
  out.revision = fingerprint(out);
  return out;
}

function writeAll(payload) {
  // Expect payload to contain transactions, loans, categories, budgets, goals
  const t = (payload.transactions || []).map(normalizeTransaction).filter(Boolean);
  const l = (payload.loans || []).map(normalizeLoan).filter(Boolean);
  const c = uniqueCategories(payload.categories || []);
  const b = (payload.budgets || []).map(item => [String(item.category || ''), Number(item.amount || 0)]);
  const g = (payload.goals || []).map(item => [String(item.name || ''), Number(item.target || 0), Number(item.saved || 0)]);

  // Write Transactions
  writeTable('Transactions', TRANSACTION_HEADERS, t.map(tx => [
    tx.id, tx.type, tx.amount, tx.date, tx.category, tx.note, tx.loanId, tx.loanType, tx.createdAt
  ]));

  // Write Loans
  writeTable('Loans', LOAN_HEADERS, l.map(ln => [
    ln.id, ln.name, ln.principal, ln.remaining, ln.date, ln.note, ln.createdAt
  ]));

  // Write Categories
  writeTable('Categories', CATEGORY_HEADERS, c.map(cat => [cat.name, cat.type, cat.createdAt]));

  // Write Budgets
  writeTable('Budgets', BUDGET_HEADERS, b);

  // Write Goals
  writeTable('Goals', GOAL_HEADERS, g);
}

function writeTable(name, headers, rows) {
  const sh = sheet(name, headers);
  // clear content but keep formatting
  sh.clearContents();
  // set header row
  if (headers && headers.length) sh.getRange(1,1,1,headers.length).setValues([headers]);
  // set rows
  if (rows && rows.length) {
    sh.getRange(2,1,rows.length, headers.length).setValues(rows);
  }
  sh.setFrozenRows(1);
}

/* ---------- Web endpoints ---------- */

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : 'status';
    if (action === 'getAll') {
      return out({ ok: true, data: readAll() });
    }
    if (action === 'status') {
      return out({ ok: true, data: status() });
    }
    return out({ ok: true, message: 'MoneyFlow Apps Script endpoint' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const payload = safeParse(e && e.postData && e.postData.contents ? e.postData.contents : '{}') || {};
    const action = payload.action || payload?.body?.action || 'status';
    if (action === 'getAll') {
      return out({ ok: true, data: readAll() });
    }
    if (action === 'status') {
      return out({ ok: true, data: status() });
    }
    if (action === 'replaceAll' || action === 'writeAll') {
      // payload.payload or payload.body or payload itself may contain the data
      const data = payload.payload || payload.body || payload;
      // Accept both {action:'replaceAll', payload:{...}} and {action:'replaceAll', transactions:[], ...}
      const toWrite = data.payload || data; // if nested
      writeAll(toWrite);
      return out({ ok: true, message: 'Replaced data' });
    }
    return out({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function status() {
  const d = readAll();
  return {
    revision: d.revision,
    transactionCount: (d.transactions || []).length,
    loanCount: (d.loans || []).length,
    categoryCount: (d.categories || []).length,
    budgetCount: (d.budgets || []).length,
    goalCount: (d.goals || []).length
  };
}
