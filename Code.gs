// ─────────────────────────────────────────────────────────────────────────
// 생활비 가계부 GAS 백엔드
// 배포: 웹 앱 / 다음 사용자로 실행: 나 / 액세스: 모든 사람 (익명 포함)
// 배포 후 index.html의 DEFAULT_GAS_URL에 배포 URL을 붙여넣을 것
// ─────────────────────────────────────────────────────────────────────────

const SH = {
  EXPENSES : 'Expenses',
  INCOME   : 'Income',
  BUDGETS  : 'Budgets',
  CATS_VAR : 'Categories_Variable',
  CATS_FIX : 'Categories_Fixed',
  SETTINGS : 'Settings'
}

const EXPENSE_COLS = ['id','date','amount','name','cat','sub']
const INCOME_COLS = ['id','date','amount','name']

// ── 진입점 ────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet()
    const D = {
      expenses: readRows(ss, SH.EXPENSES, EXPENSE_COLS).map(function(r){
        r.amount = Number(r.amount) || 0
        return r
      }),
      income: readRows(ss, SH.INCOME, INCOME_COLS).map(function(r){
        r.amount = Number(r.amount) || 0
        return r
      }),
      budgets: readBudgets(ss),
      cats: {
        variable: readSimpleList(ss, SH.CATS_VAR),
        fixed: readSimpleList(ss, SH.CATS_FIX)
      },
      _savedAt: readSavedAt(ss)
    }
    return ContentService.createTextOutput(JSON.stringify(D))
      .setMimeType(ContentService.MimeType.JSON)
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
  }
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet()
    const D = JSON.parse(e.postData.contents)

    writeRows(ss, SH.EXPENSES, D.expenses || [], EXPENSE_COLS, ['date'])
    writeRows(ss, SH.INCOME, D.income || [], INCOME_COLS, ['date'])
    writeBudgets(ss, D.budgets || {})
    writeSimpleList(ss, SH.CATS_VAR, (D.cats && D.cats.variable) || [])
    writeSimpleList(ss, SH.CATS_FIX, (D.cats && D.cats.fixed) || [])
    writeSavedAt(ss, D._savedAt || Date.now())

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON)
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON)
  }
}

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────────

function getOrCreate(ss, name, headers) {
  let sh = ss.getSheetByName(name)
  if (!sh) {
    sh = ss.insertSheet(name)
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#E8F0FE')
    sh.setFrozenRows(1)
  }
  return sh
}

// textCols: 이 헤더 이름들은 시트가 날짜로 자동 변환하지 못하게 텍스트 서식을 강제함
// (구글시트가 'YYYY-MM-DD' 문자열을 날짜 타입으로 바꿔버려서 나중에 매칭 실패하는 버그 방지)
function writeRows(ss, sheetName, rows, headers, textCols) {
  const sh = getOrCreate(ss, sheetName, headers)
  const lastRow = sh.getLastRow()
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, headers.length).clearContent()
  if (!rows.length) return

  const values = rows.map(function(row) {
    return headers.map(function(h) { return row[h] == null ? '' : row[h] })
  })
  const range = sh.getRange(2, 1, values.length, headers.length)

  if (textCols && textCols.length) {
    textCols.forEach(function(col) {
      const idx = headers.indexOf(col)
      if (idx >= 0) sh.getRange(2, idx + 1, values.length, 1).setNumberFormat('@')
    })
  }
  range.setValues(values)
}

function readRows(ss, sheetName, headers) {
  const sh = ss.getSheetByName(sheetName)
  if (!sh || sh.getLastRow() < 2) return []
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues()
  return values
    .filter(function(row) { return row.some(function(c) { return c !== '' }) })
    .map(function(row) {
      const obj = {}
      headers.forEach(function(h, i) { obj[h] = row[i] })
      return obj
    })
}

// ── Budgets 시트 (month, amount) ──────────────────────────────────────────

function readBudgets(ss) {
  const rows = readRows(ss, SH.BUDGETS, ['month', 'amount'])
  const out = {}
  rows.forEach(function(r) { out[String(r.month)] = Number(r.amount) || 0 })
  return out
}

function writeBudgets(ss, budgets) {
  const rows = Object.keys(budgets).map(function(m) { return { month: m, amount: budgets[m] } })
  writeRows(ss, SH.BUDGETS, rows, ['month', 'amount'], ['month'])
}

// ── Categories 시트 (name 한 컬럼짜리 단순 리스트) ─────────────────────────

function readSimpleList(ss, sheetName) {
  return readRows(ss, sheetName, ['name']).map(function(r) { return String(r.name) })
}

function writeSimpleList(ss, sheetName, list) {
  const rows = list.map(function(name) { return { name: name } })
  writeRows(ss, sheetName, rows, ['name'])
}

// ── Settings 시트 (_savedAt 하나만 저장) ───────────────────────────────────

function readSavedAt(ss) {
  const sh = ss.getSheetByName(SH.SETTINGS)
  if (!sh || sh.getLastRow() < 2) return 0
  return Number(sh.getRange(2, 2).getValue()) || 0
}

function writeSavedAt(ss, savedAt) {
  const sh = getOrCreate(ss, SH.SETTINGS, ['key', 'value'])
  sh.getRange(2, 1, 1, 2).setValues([['_savedAt', savedAt]])
}
