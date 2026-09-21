// ========================================
// 馆藏盘点：差异判定与导入解析（纯逻辑，无副作用，便于测试与复用）
// ========================================

// 差异状态枚举
// uncounted  未实盘（在盘点范围内，但尚未导入/录入实盘数量）
// match      账实相符
// shortage   盘亏（实盘 < 系统在架）
// overage    盘盈（实盘 > 系统在架）
// deleted    条目已删除（实盘到的馆藏，其系统条目已被删除/注销）
// out_scope  超范围（实盘到了本次盘点范围之外的在架条目）
export const DIFF_STATUS = {
  UNCOUNTED: 'uncounted',
  MATCH: 'match',
  SHORTAGE: 'shortage',
  OVERAGE: 'overage',
  DELETED: 'deleted',
  OUT_SCOPE: 'out_scope'
}

// 需要确认的差异（账实相符 / 未实盘 之外的情形）
export const CONFIRMABLE_STATUS = [
  DIFF_STATUS.SHORTAGE,
  DIFF_STATUS.OVERAGE,
  DIFF_STATUS.DELETED,
  DIFF_STATUS.OUT_SCOPE
]

export const STATUS_META = {
  [DIFF_STATUS.UNCOUNTED]: { label: '未实盘', color: 'default' },
  [DIFF_STATUS.MATCH]: { label: '账实相符', color: 'green' },
  [DIFF_STATUS.SHORTAGE]: { label: '盘亏', color: 'red' },
  [DIFF_STATUS.OVERAGE]: { label: '盘盈', color: 'orange' },
  [DIFF_STATUS.DELETED]: { label: '条目已删除', color: 'volcano' },
  [DIFF_STATUS.OUT_SCOPE]: { label: '超范围', color: 'purple' }
}

// 任务状态
export const TASK_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
}

export function todayStr() {
  return new Date().toISOString().split('T')[0]
}

export function nowTime() {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

// 归一化 ISBN：去除空格与连字符，便于跨格式匹配
export function normalizeIsbn(isbn) {
  return String(isbn == null ? '' : isbn).replace(/[-\s]/g, '').toLowerCase()
}

// 行文本切分：支持逗号（中英文）、制表符、分号
function splitLine(line) {
  return line.split(/[,\t，;；]/).map(cell => cell.trim())
}

// 从一行单元格中解析出标识与数量
// 列约定（任意顺序，表头可识别）：图书ID / ISBN / 书名 / 数量
// 无表头时：[标识, 数量?]，标识按 纯数字→ID、含ISBN特征→ISBN、否则→书名 判定
function parseCells(cells, headerMap) {
  let identifier = ''
  let qty = null

  if (headerMap) {
    const get = names => {
      for (const n of names) {
        if (headerMap[n] != null && cells[headerMap[n]] != null) return cells[headerMap[n]]
      }
      return ''
    }
    identifier = get(['id', 'bookId', '图书id', '图书编号', '编号', 'isbn', '书名', 'title'])
    const qtyRaw = get(['qty', 'quantity', 'count', '数量', '实盘数量', '册数'])
    qty = qtyRaw === '' ? null : qtyRaw
  } else if (cells.length) {
    identifier = cells[0] || ''
    qty = cells.length > 1 ? cells[1] : null
  }

  let qtyNum = qty == null || String(qty).trim() === '' ? 1 : Number(String(qty).trim())
  if (!Number.isFinite(qtyNum) || qtyNum < 0) qtyNum = NaN

  return { identifier: String(identifier == null ? '' : identifier).trim(), qty: qtyNum }
}

// 识别表头，返回列名 -> 列索引
function buildHeaderMap(firstLine) {
  const head = splitLine(firstLine).map(c => c.toLowerCase().replace(/\s/g, ''))
  const map = {}
  head.forEach((name, idx) => {
    if (['图书id', '图书编号', '编号', 'id', 'bookid'].includes(name)) map.id = idx
    else if (name === 'isbn') map.isbn = idx
    else if (['书名', 'title', '名称'].includes(name)) map.title = idx
    else if (['数量', '实盘数量', '册数', 'qty', 'quantity', 'count'].includes(name)) map.qty = idx
  })
  return map.id != null || map.isbn != null || map.title != null ? map : null
}

// 依据标识在当前馆藏中定位条目
function resolveBook(identifier, books) {
  if (!identifier) return null
  // 纯数字优先按 ID
  if (/^\d+$/.test(identifier)) {
    const byId = books.find(b => String(b.id) === identifier)
    if (byId) return byId
  }
  // ISBN（归一化比较）
  const norm = normalizeIsbn(identifier)
  const byIsbn = books.find(b => normalizeIsbn(b.isbn) === norm)
  if (byIsbn) return byIsbn
  // 书名（精确，其次包含）
  const byTitle = books.find(b => b.title === identifier)
  if (byTitle) return byTitle
  const byLike = books.find(b => b.title.includes(identifier) || identifier.includes(b.title))
  return byLike || null
}

/**
 * 解析导入文本（CSV/TSV/粘贴文本，含或不含表头均可）
 * 返回 { rows, invalid, hasHeader }
 *  - rows: [{ line, identifier, qty, bookId }]  bookId 可能为 null（未识别）
 *  - invalid: [{ line, identifier, reason }]   数量非法等问题行（不阻断其余行）
 */
export function parseImportText(text, books) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (!lines.length) return { rows: [], invalid: [], hasHeader: false }

  let headerMap = null
  let bodyStart = 0
  const maybeHeader = buildHeaderMap(lines[0])
  if (maybeHeader) {
    headerMap = maybeHeader
    bodyStart = 1
  }

  const rows = []
  const invalid = []

  for (let i = bodyStart; i < lines.length; i++) {
    const cells = splitLine(lines[i])
    if (cells.every(c => c === '')) continue
    const { identifier, qty } = parseCells(cells, headerMap)
    const lineNo = i + 1

    if (!identifier) {
      invalid.push({ line: lineNo, identifier: '', reason: '缺少图书标识（ID / ISBN / 书名）' })
      continue
    }
    if (Number.isNaN(qty)) {
      invalid.push({ line: lineNo, identifier, reason: '数量不是有效的非负数字' })
      continue
    }
    const book = resolveBook(identifier, books)
    rows.push({ line: lineNo, identifier, qty, bookId: book ? book.id : null })
  }

  return { rows, invalid, hasHeader: !!headerMap }
}

// 某条目当前未归还（借出中 / 逾期）的册数 —— 仅读取借阅记录，不修改
export function activeBorrowCount(bookId, borrowRecords) {
  return borrowRecords.filter(
    r => r.bookId === bookId && (r.status === 'borrowed' || r.status === 'overdue')
  ).length
}

// 判定一条差异的状态
function resolveStatus({ isScoped, live, countedQty, deleted }) {
  if (!live) {
    // 系统中找不到该条目
    if (deleted) return DIFF_STATUS.DELETED
    // 实盘到、但既不在范围也无删除快照（理论上导入阶段已拦截，兜底处理）
    return DIFF_STATUS.OVERAGE
  }
  if (!isScoped) return DIFF_STATUS.OUT_SCOPE
  if (countedQty == null) return DIFF_STATUS.UNCOUNTED
  if (countedQty === live.available) return DIFF_STATUS.MATCH
  return countedQty < live.available ? DIFF_STATUS.SHORTAGE : DIFF_STATUS.OVERAGE
}

/**
 * 依据当前系统库存/借阅，构建盘点差异明细（每次实时计算，保证不依赖旧快照误判）
 * @param {object} task   盘点任务（含 scope / counted / confirms）
 * @param {array} books   当前系统图书（只读）
 * @param {array} borrows 当前借阅记录（只读）
 */
export function buildDiscrepancies(task, books, borrows) {
  const scopedBooks = books.filter(b => inScope(b, task.scope))

  const rows = []

  // 1) 范围内的系统条目
  for (const book of scopedBooks) {
    rows.push(makeRow({ task, book, isScoped: true, borrows }))
  }

  // 2) 实盘到、但不属于范围内现藏的条目（超范围 / 已删除）
  for (const key of Object.keys(task.counted || {})) {
    const id = Number(key)
    const live = books.find(b => b.id === id)
    if (live && scopedBooks.some(b => b.id === id)) continue
    rows.push(makeRow({ task, book: live, isScoped: false, borrows, forcedId: id }))
  }

  // 排序：未实盘 → 盘亏 → 盘盈 → 已删除 → 超范围 → 相符；同组按 ID
  const order = {
    [DIFF_STATUS.UNCOUNTED]: 0,
    [DIFF_STATUS.SHORTAGE]: 1,
    [DIFF_STATUS.OVERAGE]: 2,
    [DIFF_STATUS.DELETED]: 3,
    [DIFF_STATUS.OUT_SCOPE]: 4,
    [DIFF_STATUS.MATCH]: 5
  }
  return rows.sort((a, b) => (order[a.status] - order[b.status]) || (a.bookId - b.bookId))
}

function makeRow({ task, book, isScoped, borrows, forcedId }) {
  const id = book ? book.id : forcedId
  const counted = (task.counted || {})[id]
  const countedQty = counted ? counted.qty : null
  const snapshot = counted || null
  const deleted = !book && snapshot && snapshot.deletedSnapshot

  const status = resolveStatus({
    isScoped,
    live: book,
    countedQty,
    deleted: !!deleted
  })

  const expected = book ? book.available : 0
  const diff = countedQty == null ? null : countedQty - expected
  const confirm = (task.confirms || {})[id]
  const activeBorrows = book ? activeBorrowCount(book.id, borrows) : 0

  return {
    bookId: id,
    key: String(id),
    isbn: book ? book.isbn : (deleted ? deleted.isbn : ''),
    title: book ? book.title : (deleted ? deleted.title : `未识别条目#${id}`),
    location: book ? book.location : (deleted ? deleted.location : ''),
    categoryName: book ? book.categoryName : (deleted ? deleted.categoryName : ''),
    exists: !!book,
    isScoped,
    expected,                     // 系统在架数量（取自系统库存，盘点不回写）
    countedQty,                   // 实盘数量
    diff,                         // 实盘 - 系统在架
    activeBorrows,                // 当前未归还册数（只读借阅记录）
    status,
    duplicateCount: counted ? counted.duplicateCount || 0 : 0,
    rowsCount: counted ? counted.rowsCount || (countedQty == null ? 0 : 1) : 0,
    note: counted ? counted.note || '' : '',
    confirmed: !!(confirm && confirm.confirmed),
    remark: confirm ? confirm.remark || '' : '',
    confirmedAt: confirm ? confirm.confirmedAt || '' : '',
    // 确认后差异类型若发生变化，需要提示复核（确认状态本身保留，不丢失）
    statusChangedAfterConfirm: !!(confirm && confirm.confirmed && confirm.atStatus && confirm.atStatus !== status)
  }
}

// 范围判定
export function inScope(book, scope) {
  if (!scope || scope.type === 'all') return true
  if (scope.type === 'category') return book.categoryId === scope.categoryId
  if (scope.type === 'location') {
    const kw = String(scope.keyword || '').trim().toLowerCase()
    return kw ? String(book.location || '').toLowerCase().includes(kw) : true
  }
  return true
}

// 汇总统计
export function summarize(rows) {
  const summary = {
    total: rows.length,
    uncounted: 0,
    match: 0,
    shortage: 0,
    overage: 0,
    deleted: 0,
    outScope: 0,
    diffCount: 0,           // 需确认差异数
    confirmedCount: 0,      // 已确认差异数
    expectedTotal: 0,
    countedTotal: 0
  }
  for (const r of rows) {
    if (r.status === DIFF_STATUS.UNCOUNTED) summary.uncounted++
    else if (r.status === DIFF_STATUS.MATCH) summary.match++
    else if (r.status === DIFF_STATUS.SHORTAGE) summary.shortage++
    else if (r.status === DIFF_STATUS.OVERAGE) summary.overage++
    else if (r.status === DIFF_STATUS.DELETED) summary.deleted++
    else if (r.status === DIFF_STATUS.OUT_SCOPE) summary.outScope++

    if (CONFIRMABLE_STATUS.includes(r.status)) {
      summary.diffCount++
      if (r.confirmed) summary.confirmedCount++
    }
    if (r.isScoped) {
      summary.expectedTotal += r.expected
      if (r.countedQty != null) summary.countedTotal += r.countedQty
    }
  }
  summary.progress = summary.total ? Math.round((summary.total - summary.uncounted) / summary.total * 100) : 100
  return summary
}

/**
 * 完成任务的门禁
 * 返回 { canComplete, reasons }
 */
export function checkCompletion(rows) {
  const reasons = []
  const uncounted = rows.filter(r => r.status === DIFF_STATUS.UNCOUNTED)
  if (uncounted.length) {
    reasons.push(`仍有 ${uncounted.length} 条范围内条目尚未实盘`)
  }
  const unconfirmed = rows.filter(r => CONFIRMABLE_STATUS.includes(r.status) && !r.confirmed)
  if (unconfirmed.length) {
    reasons.push(`仍有 ${unconfirmed.length} 条差异未确认`)
  }
  const changed = rows.filter(r => r.statusChangedAfterConfirm)
  if (changed.length) {
    reasons.push(`${changed.length} 条已确认记录的差异类型已变化，请复核`)
  }
  return { canComplete: reasons.length === 0, reasons }
}

// 导入模板
export const IMPORT_TEMPLATE = '图书ID,数量\n1,7\n2,2\n'
