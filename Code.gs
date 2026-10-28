// ─────────────────────────────────────────────────────────────────────────
// 생활비 가계부 GAS 백엔드
// 배포: 웹 앱 / 다음 사용자로 실행: 나 / 액세스: 모든 사람 (익명 포함)
// 배포 후 index.html의 DEFAULT_GAS_URL에 배포 URL을 붙여넣을 것
//
// 공유 키: 프로젝트 설정 > 스크립트 속성에 LC_KEY를 추가하면, 그 값이 맞는 요청만 처리함
// (이 파일은 공개 저장소에 올라가므로 키를 코드에 직접 적지 말 것)
// ─────────────────────────────────────────────────────────────────────────

// 앱이 이 값을 확인해서, 서버가 옛 버전이면 올리지 않고 변경을 기기에 보관함 (새 필드가 조용히 버려지는 사고 방지)
const SCHEMA = 4

const SH = {
  EXPENSES : 'Expenses',
  INCOME   : 'Income',
  BUDGETS  : 'Budgets',
  DEPOSITS : 'Deposits',
  CATS     : 'Categories',
  CATS_VAR : 'Categories_Variable', // 예전 구조, 이전 데이터를 읽어서 옮길 때만 사용
  CATS_FIX : 'Categories_Fixed',    // 예전 구조, 이전 데이터를 읽어서 옮길 때만 사용
  SETTINGS : 'Settings',
  LEDGER_EXP  : 'Ledger_Expenses',   // 예진/재하/경조사 장부의 지출 (ledger 열로 구분)
  LEDGER_INC  : 'Ledger_Income',
  LEDGER_CATS : 'Ledger_Categories',
  LEDGER_CARDS: 'Ledger_Cards',      // 예진/재하가 등록한 신용카드 (실적 기준액 포함)
  EVENT       : 'Event'              // 경조사통장 설정 (key, value)
}

const LEDGERS = ['yj', 'jh', 'event']

// sub는 예전 고정비 세부카테고리 열이라 값은 항상 비어 있음 (열 위치를 유지하려고 남겨둠)
const EXPENSE_COLS = ['id','date','amount','name','cat','sub','pay']
const INCOME_COLS = ['id','date','amount','name']
const DEPOSIT_COLS = ['month','yj','jh']
// pay/card는 schema 4에서 맨 뒤에 추가 (기존 열 위치 유지). 경조사 장부는 결제수단이 없어 비어 있음
const LEDGER_EXP_COLS = ['ledger','id','date','amount','name','cat','pay','card']
const LEDGER_INC_COLS = ['ledger','id','date','amount','name']
const LEDGER_CAT_COLS = ['ledger','name']
const LEDGER_CARD_COLS = ['ledger','id','name','target']

// 한 번의 업로드로 행 수가 이 비율 미만으로 줄면 오류로 보고 거부함 (빈 데이터로 덮어쓰는 사고 방지)
const SHRINK_MIN_ROWS = 10
const SHRINK_RATIO = 0.5

// ── 진입점 ────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    if (!authorized(e && e.parameter && e.parameter.key)) return json({ error: 'unauthorized' })
    return withLock(function() {
      const ss = SpreadsheetApp.getActiveSpreadsheet()
      return json({
        expenses: readRows(ss, SH.EXPENSES, EXPENSE_COLS).map(function(r){
          r.amount = Number(r.amount) || 0
          return r
        }),
        income: readRows(ss, SH.INCOME, INCOME_COLS).map(function(r){
          r.amount = Number(r.amount) || 0
          return r
        }),
        budgets: readBudgets(ss),
        deposits: readDeposits(ss),
        cats: {
          list: readSimpleList(ss, SH.CATS),
          variable: readSimpleList(ss, SH.CATS_VAR),
          fixed: readSimpleList(ss, SH.CATS_FIX)
        },
        ledgers: readLedgers(ss),
        eventCfg: readEvent(ss),
        _schema: SCHEMA,
        _savedAt: readSavedAt(ss)
      })
    })
  } catch (err) {
    return json({ error: err.toString() })
  }
}

function doPost(e) {
  try {
    const D = JSON.parse(e.postData.contents)
    if (!authorized(D._key)) return json({ ok: false, error: 'unauthorized' })

    return withLock(function() {
      const ss = SpreadsheetApp.getActiveSpreadsheet()
      const expenses = D.expenses || []
      const income = D.income || []
      // 개인/경조사 장부 영역이 들어 있지 않은 업로드(옛 화면)로는 그 시트를 비우지 않음
      const flat = D.ledgers ? flatLedgers(D.ledgers) : null

      if (shrinks(rowCount(ss, SH.EXPENSES), expenses.length) || shrinks(rowCount(ss, SH.INCOME), income.length) ||
          (flat && (shrinks(rowCount(ss, SH.LEDGER_EXP), flat.exp.length) || shrinks(rowCount(ss, SH.LEDGER_INC), flat.inc.length)))) {
        return json({ ok: false, error: 'shrink' })
      }

      writeRows(ss, SH.EXPENSES, expenses, EXPENSE_COLS, ['date'])
      writeRows(ss, SH.INCOME, income, INCOME_COLS, ['date'])
      writeBudgets(ss, D.budgets || {})
      writeDeposits(ss, D.deposits || {})
      writeSimpleList(ss, SH.CATS, (D.cats && D.cats.list) || [])
      if (flat) {
        keepPayFromOldClients(ss, flat.exp)
        writeRows(ss, SH.LEDGER_EXP, flat.exp, LEDGER_EXP_COLS, ['date'])
        writeRows(ss, SH.LEDGER_INC, flat.inc, LEDGER_INC_COLS, ['date'])
        writeRows(ss, SH.LEDGER_CATS, flat.cats, LEDGER_CAT_COLS)
        writeRows(ss, SH.LEDGER_CARDS, flat.cards, LEDGER_CARD_COLS)
      }
      if (D.eventCfg) writeEvent(ss, D.eventCfg)
      writeSavedAt(ss, D._savedAt || Date.now())

      return json({ ok: true, _schema: SCHEMA })
    })
  } catch (err) {
    return json({ ok: false, error: err.toString() })
  }
}

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────────

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON)
}

// LC_KEY가 설정돼 있으면 일치하는 요청만 통과시킴 (설정 전에는 막지 않음)
function authorized(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('LC_KEY')
  return !expected || key === expected
}

// 읽기/쓰기가 동시에 시트를 건드리지 않게 직렬화함 (쓰기는 시트를 비운 뒤 다시 채우므로, 그 사이에 읽으면 빈 데이터가 나감)
function withLock(fn) {
  const lock = LockService.getScriptLock()
  lock.waitLock(25000)
  try { return fn() } finally { lock.releaseLock() }
}

function rowCount(ss, name) {
  const sh = ss.getSheetByName(name)
  return sh ? Math.max(0, sh.getLastRow() - 1) : 0
}

function shrinks(before, after) {
  return before >= SHRINK_MIN_ROWS && after < before * SHRINK_RATIO
}

function getOrCreate(ss, name, headers) {
  let sh = ss.getSheetByName(name)
  if (!sh) {
    sh = ss.insertSheet(name)
    sh.setFrozenRows(1)
  }
  // 열이 추가된 경우(예: pay) 기존 시트의 머리글도 맞춰줌
  const cur = sh.getRange(1, 1, 1, headers.length).getValues()[0]
  if (cur.join('|') !== headers.join('|')) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#E8F0FE')
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

// ── Deposits 시트 (month, yj, jh) — 공통통장에 매달 입금하는 금액 ─────────────

function readDeposits(ss) {
  const out = {}
  readRows(ss, SH.DEPOSITS, DEPOSIT_COLS).forEach(function(r) {
    out[String(r.month)] = { yj: Number(r.yj) || 0, jh: Number(r.jh) || 0 }
  })
  return out
}

function writeDeposits(ss, deposits) {
  const rows = Object.keys(deposits).map(function(m) {
    return { month: m, yj: deposits[m].yj, jh: deposits[m].jh }
  })
  writeRows(ss, SH.DEPOSITS, rows, DEPOSIT_COLS, ['month'])
}

// ── 개인(yj, jh)/경조사(event) 장부 — 한 시트에 ledger 열로 구분해서 저장 ─────────

function readLedgers(ss) {
  const out = {}
  LEDGERS.forEach(function(l) { out[l] = { expenses: [], income: [], cats: [], cards: [] } })

  readRows(ss, SH.LEDGER_EXP, LEDGER_EXP_COLS).forEach(function(r) {
    const l = String(r.ledger)
    if (!out[l]) return
    out[l].expenses.push({ id: r.id, date: r.date, amount: Number(r.amount) || 0, name: r.name, cat: r.cat, pay: String(r.pay || ''), card: String(r.card || '') })
  })
  readRows(ss, SH.LEDGER_INC, LEDGER_INC_COLS).forEach(function(r) {
    const l = String(r.ledger)
    if (!out[l]) return
    out[l].income.push({ id: r.id, date: r.date, amount: Number(r.amount) || 0, name: r.name })
  })
  readRows(ss, SH.LEDGER_CATS, LEDGER_CAT_COLS).forEach(function(r) {
    const l = String(r.ledger)
    if (out[l]) out[l].cats.push(String(r.name))
  })
  readRows(ss, SH.LEDGER_CARDS, LEDGER_CARD_COLS).forEach(function(r) {
    const l = String(r.ledger)
    if (out[l]) out[l].cards.push({ id: String(r.id), name: String(r.name), target: Number(r.target) || 0 })
  })
  return out
}

// 옛 화면(schema 3)은 pay/card를 몰라서, 거기서 수정한 지출은 이 필드가 아예 없이 올라옴.
// 그대로 쓰면 결제수단이 지워지므로, 필드가 없는 지출은 시트에 있던 값을 유지함 (새 화면은 결제수단이 없어도 빈 값을 보냄)
function keepPayFromOldClients(ss, rows) {
  const prev = {}
  readRows(ss, SH.LEDGER_EXP, LEDGER_EXP_COLS).forEach(function(r) { prev[r.ledger + '|' + r.id] = r })
  rows.forEach(function(e) {
    const p = prev[e.ledger + '|' + e.id]
    if (!p || 'pay' in e) return
    e.pay = p.pay
    e.card = p.card
  })
}

function flatLedgers(ledgers) {
  const exp = [], inc = [], cats = [], cards = []
  LEDGERS.forEach(function(l) {
    const b = ledgers[l] || {}
    ;(b.expenses || []).forEach(function(e) { exp.push(Object.assign({}, e, { ledger: l })) })
    ;(b.income || []).forEach(function(e) { inc.push(Object.assign({}, e, { ledger: l })) })
    ;(b.cats || []).forEach(function(name) { cats.push({ ledger: l, name: name }) })
    ;(b.cards || []).forEach(function(c) { cards.push(Object.assign({}, c, { ledger: l })) })
  })
  return { exp: exp, inc: inc, cats: cats, cards: cards }
}

// ── Event 시트 (경조사통장 설정: 목표 금액, 각자 월 입금액, 실제 잔액으로 맞춘 기준일/기준 잔액) ──

function readEvent(ss) {
  const m = {}
  readRows(ss, SH.EVENT, ['key', 'value']).forEach(function(r) { m[String(r.key)] = r.value })
  return {
    target: Number(m.target) || 0,
    each: Number(m.each) || 0,
    anchor: { date: m.anchorDate ? String(m.anchorDate) : '', balance: Number(m.anchorBalance) || 0 }
  }
}

function writeEvent(ss, cfg) {
  const a = cfg.anchor || {}
  writeRows(ss, SH.EVENT, [
    { key: 'target', value: cfg.target || 0 },
    { key: 'each', value: cfg.each || 0 },
    { key: 'anchorDate', value: a.date || '' },
    { key: 'anchorBalance', value: a.balance || 0 }
  ], ['key', 'value'], ['value'])
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
