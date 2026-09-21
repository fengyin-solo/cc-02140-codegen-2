import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import dayjs from 'dayjs'
import { books as initialBooks } from '@/data/mockData'
import { useBookStore } from './book'
import { useCategoryStore } from './category'

const STORAGE_KEY = 'library_inventory_checks'

// 分块导入参数：每块处理后都会写入任务并持久化，
// 因此导入中断时已处理的结果不会丢失，可再次导入继续
const IMPORT_CHUNK_SIZE = 4
const IMPORT_CHUNK_DELAY = 400

function now() {
  return dayjs().format('YYYY-MM-DD HH:mm:ss')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ========================================
// 演示任务：展示实盘导入、差异判定与确认流程
// ========================================
function buildSeedTasks() {
  const snapshot = initialBooks.map(b => ({
    bookId: b.id,
    isbn: b.isbn,
    title: b.title,
    author: b.author,
    categoryName: b.categoryName,
    location: b.location,
    systemQty: b.total
  }))
  return [
    {
      id: 1,
      code: 'PD20260920-01',
      name: '2026年秋季馆藏盘点（示例）',
      scope: 'all',
      categoryId: null,
      categoryName: '全部馆藏',
      remark: '示例任务：演示实盘导入、差异判定与差异确认流程',
      status: 'in_progress',
      createdAt: '2026-09-20 09:30:00',
      completedAt: null,
      snapshot,
      results: [
        { bookId: 1, actualQty: 10, source: 'import', updatedAt: '2026-09-20 10:02:15' },
        { bookId: 2, actualQty: 6, source: 'import', updatedAt: '2026-09-20 10:02:15' },
        { bookId: 3, actualQty: 13, source: 'import', updatedAt: '2026-09-20 10:02:15' },
        { bookId: 4, actualQty: 6, source: 'import', updatedAt: '2026-09-20 10:02:15' },
        { bookId: 5, actualQty: 5, source: 'import', updatedAt: '2026-09-20 10:02:15' }
      ],
      reviews: {
        2: {
          confirmed: true,
          note: '2册借出逾期未还，已电话通知读者尽快归还',
          confirmedAt: '2026-09-20 11:20:43'
        }
      },
      importState: 'done',
      importLog: [
        { time: '2026-09-20 10:02:15', type: 'info', message: '导入完成：共 5 条（新增 5）' }
      ]
    }
  ]
}

export const useInventoryCheckStore = defineStore('inventoryCheck', () => {
  const loadTasks = () => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch (e) {
        console.error('Failed to parse stored inventory checks:', e)
      }
    }
    return buildSeedTasks()
  }

  const tasks = ref(loadTasks())
  const loading = ref(false)

  // 任何变化（含导入中、确认、备注）都立即持久化，刷新/重开不丢失
  watch(tasks, (newTasks) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newTasks))
  }, { deep: true })

  // ========================================
  // 查询与联动计算
  // ========================================

  function getTaskById(id) {
    return tasks.value.find(task => task.id === Number(id))
  }

  /**
   * 盘点差异 = 任务快照 × 实盘结果 × 确认状态 实时联动计算。
   * 快照在任务创建时生成，之后的馆藏变更（含删除）不影响比对基准；
   * 条目已被删除时仅做标记，差异仍按快照计算。
   */
  function getTaskDiffs(id) {
    const task = getTaskById(id)
    if (!task) return []
    const bookStore = useBookStore()
    return task.snapshot.map(item => {
      const result = task.results.find(r => r.bookId === item.bookId)
      const review = task.reviews[item.bookId] || null
      const deleted = !bookStore.getBookById(item.bookId)
      const actualQty = result ? result.actualQty : null
      let type = 'unchecked'
      let diff = null
      if (actualQty !== null && actualQty !== undefined) {
        diff = actualQty - item.systemQty
        type = diff === 0 ? 'match' : diff > 0 ? 'surplus' : 'loss'
      }
      return {
        ...item,
        actualQty,
        diff,
        type, // match 相符 | surplus 盘盈 | loss 盘亏 | unchecked 未盘
        deleted,
        source: result ? result.source : null,
        confirmed: !!(review && review.confirmed),
        note: review ? review.note || '' : '',
        confirmedAt: review ? review.confirmedAt : null
      }
    })
  }

  function getTaskStats(id) {
    const diffs = getTaskDiffs(id)
    const stats = {
      total: diffs.length,
      checked: 0,
      match: 0,
      surplus: 0,
      loss: 0,
      unchecked: 0,
      deleted: 0,
      confirmedDiffs: 0,
      unconfirmedDiffs: 0,
      progress: 0
    }
    for (const d of diffs) {
      if (d.type === 'unchecked') {
        stats.unchecked++
      } else {
        stats.checked++
        if (d.type === 'match') stats.match++
        if (d.type === 'surplus') stats.surplus++
        if (d.type === 'loss') stats.loss++
        if (d.type === 'surplus' || d.type === 'loss') {
          if (d.confirmed) stats.confirmedDiffs++
          else stats.unconfirmedDiffs++
        }
      }
      if (d.deleted) stats.deleted++
    }
    stats.progress = stats.total === 0 ? 100 : Math.round((stats.checked / stats.total) * 100)
    return stats
  }

  const totalTasks = computed(() => tasks.value.length)
  const inProgressCount = computed(() => tasks.value.filter(t => t.status === 'in_progress').length)
  const completedCount = computed(() => tasks.value.filter(t => t.status === 'completed').length)
  const pendingConfirmCount = computed(() =>
    tasks.value.reduce((sum, task) => {
      if (task.status !== 'in_progress') return sum
      return sum + getTaskStats(task.id).unconfirmedDiffs
    }, 0)
  )

  // ========================================
  // 任务生命周期
  // ========================================

  /**
   * 创建盘点任务：按当前系统库存生成快照。
   * 注意：盘点全程只读取图书数据，绝不修改系统库存与借阅记录。
   */
  function createTask({ name, scope, categoryId, remark }) {
    const bookStore = useBookStore()
    const categoryStore = useCategoryStore()
    const inScope = scope === 'category' && categoryId
      ? bookStore.books.filter(b => b.categoryId === categoryId)
      : bookStore.books

    const today = dayjs().format('YYYYMMDD')
    const seq = tasks.value.filter(t => t.code && t.code.includes(today)).length + 1
    const newId = tasks.value.length > 0
      ? Math.max(...tasks.value.map(t => t.id)) + 1
      : 1

    const task = {
      id: newId,
      code: `PD${today}-${String(seq).padStart(2, '0')}`,
      name,
      scope,
      categoryId: scope === 'category' ? categoryId : null,
      categoryName: scope === 'category'
        ? (categoryStore.getCategoryById(categoryId)?.name || '')
        : '全部馆藏',
      remark: remark || '',
      status: 'in_progress',
      createdAt: now(),
      completedAt: null,
      snapshot: inScope.map(b => ({
        bookId: b.id,
        isbn: b.isbn,
        title: b.title,
        author: b.author,
        categoryName: b.categoryName,
        location: b.location,
        systemQty: b.total
      })),
      results: [],
      reviews: {},
      importState: 'none',
      importLog: []
    }
    tasks.value.push(task)
    log(task, 'info', `任务创建，盘点范围共 ${task.snapshot.length} 个馆藏条目`)
    return newId
  }

  /** 是否存在同范围、进行中的任务（用于重复盘点提醒） */
  function findOverlappingTask(scope, categoryId) {
    return tasks.value.find(t =>
      t.status === 'in_progress' &&
      (t.scope === 'all' || scope === 'all' ||
        (t.scope === 'category' && scope === 'category' && t.categoryId === categoryId))
    )
  }

  /**
   * 完成任务。校验：范围内所有条目均已盘点，且全部差异已确认。
   * 空任务（范围内无馆藏条目）可直接完成。
   */
  function completeTask(id) {
    const task = getTaskById(id)
    if (!task) return { ok: false, reason: '任务不存在' }
    if (task.status === 'completed') return { ok: false, reason: '任务已完成' }
    const stats = getTaskStats(id)
    if (stats.total > 0) {
      if (stats.unchecked > 0) {
        return { ok: false, reason: `还有 ${stats.unchecked} 个馆藏条目未盘点，请先导入或录入实盘结果` }
      }
      if (stats.unconfirmedDiffs > 0) {
        return { ok: false, reason: `还有 ${stats.unconfirmedDiffs} 条盘点差异未确认，请先完成差异确认` }
      }
    }
    task.status = 'completed'
    task.completedAt = now()
    log(task, 'info', '任务完成，盘点结果已归档（系统库存与借阅记录不受影响）')
    return { ok: true }
  }

  /** 回退：已完成 → 进行中。实盘结果与差异确认状态全部保留 */
  function reopenTask(id) {
    const task = getTaskById(id)
    if (!task || task.status !== 'completed') return false
    task.status = 'in_progress'
    task.completedAt = null
    log(task, 'info', '任务已回退为进行中，实盘结果与确认状态保持不变')
    return true
  }

  function deleteTask(id) {
    const index = tasks.value.findIndex(t => t.id === Number(id))
    if (index !== -1) {
      tasks.value.splice(index, 1)
      return true
    }
    return false
  }

  // ========================================
  // 实盘结果（导入 / 手工录入）
  // ========================================

  /**
   * 解析导入文本。支持每行格式：
   *   ISBN,实盘数量
   *   ISBN,书名,实盘数量（模板格式）
   * 无数字的行（如表头）自动跳过；无法解析的行标记为无效，不中断导入。
   */
  function parseImportText(text) {
    const lines = String(text || '').split(/\r?\n/)
    const rows = []
    lines.forEach((line, idx) => {
      const raw = line.trim()
      if (!raw) return
      if (!/\d/.test(raw)) return // 表头等无数据行
      const parts = raw.split(/[,，\t]/).map(s => s.trim()).filter(s => s !== '')
      const isbn = parts[0] || ''
      const qty = Number(parts[parts.length - 1])
      const valid = parts.length >= 2 && !!isbn && Number.isInteger(qty) && qty >= 0
      rows.push({ lineNo: idx + 1, isbn, qty, valid, raw })
    })
    return rows
  }

  /**
   * 分块导入实盘结果：
   * - 每处理一块即写入任务并持久化，导入中断时已导入部分保留、可恢复；
   * - 同一批次内重复盘点同一条目时取最后一条并记日志；
   * - 已有结果的条目再次导入视为覆盖更新；
   * - 无效行、范围外条目跳过并记日志，不中断整体导入。
   */
  async function importResults(taskId, rows, { onProgress, isCancelled } = {}) {
    const task = getTaskById(taskId)
    if (!task) return { ok: false, reason: '任务不存在' }
    if (task.status !== 'in_progress') return { ok: false, reason: '任务已完成，请先回退后再导入' }

    const summary = {
      total: rows.length,
      processed: 0,
      added: 0,
      updated: 0,
      duplicated: 0,
      invalid: 0,
      outOfScope: 0,
      interrupted: false
    }
    const seen = new Set()
    task.importState = 'importing'

    for (let i = 0; i < rows.length; i += IMPORT_CHUNK_SIZE) {
      if (isCancelled && isCancelled()) {
        summary.interrupted = true
        break
      }
      const chunk = rows.slice(i, i + IMPORT_CHUNK_SIZE)
      for (const row of chunk) {
        if (!row.valid) {
          summary.invalid++
          log(task, 'warning', `第 ${row.lineNo} 行无效，已跳过：${row.raw}`)
          continue
        }
        const item = task.snapshot.find(s => s.isbn === row.isbn)
        if (!item) {
          summary.outOfScope++
          log(task, 'warning', `第 ${row.lineNo} 行 ISBN ${row.isbn} 不在盘点范围，已跳过`)
          continue
        }
        if (seen.has(item.bookId)) {
          summary.duplicated++
          log(task, 'warning', `重复盘点：「${item.title}」本批次出现多次，以最后一条为准`)
        }
        seen.add(item.bookId)
        const existing = task.results.find(r => r.bookId === item.bookId)
        if (existing) {
          existing.actualQty = row.qty
          existing.source = 'import'
          existing.updatedAt = now()
          summary.updated++
        } else {
          task.results.push({ bookId: item.bookId, actualQty: row.qty, source: 'import', updatedAt: now() })
          summary.added++
        }
      }
      summary.processed = Math.min(i + chunk.length, rows.length)
      if (onProgress) onProgress(summary.processed, rows.length)
      await sleep(IMPORT_CHUNK_DELAY) // 分块落库，中断时已处理部分已持久化
    }

    if (summary.interrupted) {
      task.importState = 'interrupted'
      log(task, 'warning', `导入中断：已处理 ${summary.processed}/${summary.total} 行，已导入结果全部保留，可继续导入`)
    } else {
      task.importState = 'done'
      log(task, 'info', `导入完成：共 ${summary.total} 行（新增 ${summary.added}，覆盖 ${summary.updated}，重复合并 ${summary.duplicated}，无效 ${summary.invalid}，范围外 ${summary.outOfScope}）`)
    }
    return { ok: true, summary }
  }

  /** 手工录入/修改单个条目的实盘数量 */
  function setManualResult(taskId, bookId, actualQty) {
    const task = getTaskById(taskId)
    if (!task || task.status !== 'in_progress') return false
    if (!task.snapshot.some(s => s.bookId === bookId)) return false
    const existing = task.results.find(r => r.bookId === bookId)
    if (existing) {
      existing.actualQty = actualQty
      existing.source = 'manual'
      existing.updatedAt = now()
    } else {
      task.results.push({ bookId, actualQty, source: 'manual', updatedAt: now() })
    }
    return true
  }

  /** 清除单个条目的实盘结果（回到未盘状态） */
  function clearResult(taskId, bookId) {
    const task = getTaskById(taskId)
    if (!task || task.status !== 'in_progress') return false
    const index = task.results.findIndex(r => r.bookId === bookId)
    if (index !== -1) {
      task.results.splice(index, 1)
      return true
    }
    return false
  }

  /** 将所有未盘条目按实盘 0 处理 */
  function fillUncheckedWithZero(taskId) {
    const task = getTaskById(taskId)
    if (!task || task.status !== 'in_progress') return 0
    let count = 0
    for (const item of task.snapshot) {
      if (!task.results.some(r => r.bookId === item.bookId)) {
        task.results.push({ bookId: item.bookId, actualQty: 0, source: 'manual', updatedAt: now() })
        count++
      }
    }
    if (count > 0) {
      log(task, 'info', `未盘条目按实盘 0 处理，共 ${count} 条`)
    }
    return count
  }

  // ========================================
  // 差异确认与备注
  // ========================================

  function setReviewNote(taskId, bookId, note) {
    const task = getTaskById(taskId)
    if (!task) return false
    const review = task.reviews[bookId] || { confirmed: false, note: '', confirmedAt: null }
    review.note = note
    task.reviews[bookId] = review
    return true
  }

  function confirmDiff(taskId, bookId) {
    const task = getTaskById(taskId)
    if (!task || task.status !== 'in_progress') return false
    const review = task.reviews[bookId] || { confirmed: false, note: '', confirmedAt: null }
    review.confirmed = true
    review.confirmedAt = now()
    task.reviews[bookId] = review
    return true
  }

  function unconfirmDiff(taskId, bookId) {
    const task = getTaskById(taskId)
    if (!task || task.status !== 'in_progress') return false
    const review = task.reviews[bookId]
    if (review) {
      review.confirmed = false
      review.confirmedAt = null
    }
    return true
  }

  /** 一键确认全部未确认差异 */
  function confirmAllDiffs(taskId) {
    const diffs = getTaskDiffs(taskId)
    let count = 0
    for (const d of diffs) {
      if ((d.type === 'surplus' || d.type === 'loss') && !d.confirmed) {
        confirmDiff(taskId, d.bookId)
        count++
      }
    }
    return count
  }

  function log(task, type, message) {
    task.importLog.push({ time: now(), type, message })
    if (task.importLog.length > 50) {
      task.importLog.splice(0, task.importLog.length - 50)
    }
  }

  return {
    tasks,
    loading,
    totalTasks,
    inProgressCount,
    completedCount,
    pendingConfirmCount,
    getTaskById,
    getTaskDiffs,
    getTaskStats,
    createTask,
    findOverlappingTask,
    completeTask,
    reopenTask,
    deleteTask,
    parseImportText,
    importResults,
    setManualResult,
    clearResult,
    fillUncheckedWithZero,
    setReviewNote,
    confirmDiff,
    unconfirmDiff,
    confirmAllDiffs
  }
})
