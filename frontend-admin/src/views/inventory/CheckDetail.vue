<template>
  <div class="check-detail">
    <!-- 任务不存在 -->
    <a-result
      v-if="!task"
      status="404"
      title="盘点任务不存在"
      sub-title="该任务可能已被删除"
    >
      <template #extra>
        <a-button type="primary" @click="$router.push('/inventory')">返回盘点列表</a-button>
      </template>
    </a-result>

    <template v-else>
      <!-- 头部 -->
      <div class="detail-header card-container animate-fade-in">
        <div class="header-main">
          <a-button class="back-btn" @click="$router.push('/inventory')">
            <ArrowLeftOutlined /> 返回
          </a-button>
          <div class="title-block">
            <div class="title-line">
              <span class="task-title">{{ task.name }}</span>
              <a-badge
                :status="task.status === 'completed' ? 'success' : 'processing'"
                :text="task.status === 'completed' ? '已完成' : '进行中'"
              />
            </div>
            <div class="task-meta">
              <span>编号：{{ task.code }}</span>
              <span>范围：{{ task.categoryName }}</span>
              <span>创建：{{ task.createdAt }}</span>
              <span v-if="task.completedAt">完成：{{ task.completedAt }}</span>
              <span v-if="task.remark">备注：{{ task.remark }}</span>
            </div>
          </div>
        </div>
        <div class="header-actions">
          <a-space wrap>
            <template v-if="!readonly">
              <a-button type="primary" @click="importVisible = true">
                <ImportOutlined /> 导入实盘结果
              </a-button>
              <a-popconfirm
                title="将所有未盘条目按实盘 0 处理？"
                ok-text="确定"
                cancel-text="取消"
                :disabled="stats.unchecked === 0"
                @confirm="handleFillZero"
              >
                <a-button :disabled="stats.unchecked === 0">未盘按 0 处理</a-button>
              </a-popconfirm>
              <a-popconfirm
                title="一键确认全部盘点差异？"
                ok-text="确定"
                cancel-text="取消"
                :disabled="stats.unconfirmedDiffs === 0"
                @confirm="handleConfirmAll"
              >
                <a-button :disabled="stats.unconfirmedDiffs === 0">确认全部差异</a-button>
              </a-popconfirm>
              <a-button type="primary" class="complete-btn" @click="handleComplete">
                <CheckOutlined /> 完成任务
              </a-button>
            </template>
            <a-popconfirm
              v-else
              title="回退后任务恢复为进行中，实盘结果与差异确认状态将保留。确定回退？"
              ok-text="确定"
              cancel-text="取消"
              @confirm="handleReopen"
            >
              <a-button>
                <RollbackOutlined /> 回退任务
              </a-button>
            </a-popconfirm>
            <a-button @click="exportReport" :disabled="stats.total === 0">
              <DownloadOutlined /> 导出差异报告
            </a-button>
          </a-space>
        </div>
      </div>

      <!-- 状态提示 -->
      <div class="alerts animate-fade-in">
        <a-alert
          type="info"
          show-icon
          message="盘点基于任务创建时的库存快照进行比对，全程不会修改系统库存与借阅记录。"
        />
        <a-alert
          v-if="task.importState === 'interrupted' && !readonly"
          type="warning"
          show-icon
          message="上次实盘导入被中断"
          :description="`已保留 ${task.results.length} 条实盘结果，点击「导入实盘结果」可继续导入。`"
        />
        <a-alert
          v-if="stats.deleted > 0"
          type="warning"
          show-icon
          :message="`有 ${stats.deleted} 个条目已从馆藏中删除`"
          description="差异仍按任务创建时的快照计算，相关条目已标记「已删除」。"
        />
        <a-alert
          v-if="readonly"
          type="success"
          show-icon
          :message="`任务已于 ${task.completedAt} 完成，结果已归档`"
          description="当前为只读状态。如需调整可回退任务，实盘结果与差异确认状态不会丢失。"
        />
      </div>

      <!-- 统计 -->
      <div class="stats-panel card-container animate-fade-in">
        <a-row :gutter="16">
          <a-col :xs="8" :sm="6" :md="3">
            <a-statistic title="应盘条目" :value="stats.total" />
          </a-col>
          <a-col :xs="8" :sm="6" :md="3">
            <a-statistic title="已盘" :value="stats.checked" />
          </a-col>
          <a-col :xs="8" :sm="6" :md="3">
            <a-statistic title="相符" :value="stats.match" :value-style="{ color: '#52c41a' }" />
          </a-col>
          <a-col :xs="8" :sm="6" :md="3">
            <a-statistic title="盘盈" :value="stats.surplus" :value-style="{ color: '#1890ff' }" />
          </a-col>
          <a-col :xs="8" :sm="6" :md="3">
            <a-statistic title="盘亏" :value="stats.loss" :value-style="{ color: '#ff4d4f' }" />
          </a-col>
          <a-col :xs="8" :sm="6" :md="3">
            <a-statistic title="未盘" :value="stats.unchecked" :value-style="{ color: stats.unchecked ? '#faad14' : undefined }" />
          </a-col>
          <a-col :xs="8" :sm="6" :md="3">
            <a-statistic title="待确认差异" :value="stats.unconfirmedDiffs" :value-style="{ color: stats.unconfirmedDiffs ? '#faad14' : undefined }" />
          </a-col>
          <a-col :xs="8" :sm="6" :md="3">
            <div class="progress-stat">
              <div class="progress-label">盘点进度</div>
              <a-progress
                type="circle"
                :percent="stats.progress"
                :size="52"
                :stroke-color="stats.progress === 100 ? '#52c41a' : '#1890ff'"
              />
            </div>
          </a-col>
        </a-row>
      </div>

      <!-- 差异列表 -->
      <div class="table-container animate-fade-in">
        <div class="table-toolbar">
          <a-radio-group v-model:value="diffFilter" button-style="solid">
            <a-radio-button value="all">全部</a-radio-button>
            <a-radio-button value="diff">仅差异</a-radio-button>
            <a-radio-button value="unchecked">未盘</a-radio-button>
            <a-radio-button value="unconfirmed">待确认</a-radio-button>
            <a-radio-button value="deleted" v-if="stats.deleted > 0">已删除</a-radio-button>
          </a-radio-group>
          <a-input
            v-model:value="keyword"
            placeholder="搜索书名、ISBN"
            allow-clear
            class="keyword-input"
          >
            <template #prefix><SearchOutlined /></template>
          </a-input>
        </div>

        <a-empty
          v-if="stats.total === 0"
          description="该任务盘点范围内没有馆藏条目"
          class="empty-block"
        >
          <template v-if="!readonly">
            <a-button type="primary" @click="handleComplete">直接完成任务</a-button>
          </template>
        </a-empty>

        <a-table
          v-else
          :columns="columns"
          :data-source="filteredDiffs"
          row-key="bookId"
          :pagination="{ pageSize: 10, showTotal: total => `共 ${total} 条` }"
          :row-class-name="rowClassName"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'book'">
              <div class="book-cell">
                <div class="book-name">
                  {{ record.title }}
                  <a-tag v-if="record.deleted" color="error" class="deleted-tag">已删除</a-tag>
                </div>
                <div class="book-isbn">ISBN: {{ record.isbn }} · {{ record.author }}</div>
              </div>
            </template>
            <template v-else-if="column.key === 'systemQty'">
              <span class="qty">{{ record.systemQty }}</span>
            </template>
            <template v-else-if="column.key === 'actualQty'">
              <a-input-number
                v-if="!readonly"
                :value="record.actualQty"
                :min="0"
                :max="99999"
                :precision="0"
                placeholder="未盘"
                size="small"
                class="actual-input"
                @change="val => onActualChange(record, val)"
              />
              <span v-else class="qty">{{ record.actualQty === null ? '—' : record.actualQty }}</span>
            </template>
            <template v-else-if="column.key === 'diff'">
              <span v-if="record.diff === null" class="diff-none">—</span>
              <span v-else-if="record.diff === 0" class="diff-zero">0</span>
              <span v-else-if="record.diff > 0" class="diff-plus">+{{ record.diff }}</span>
              <span v-else class="diff-minus">{{ record.diff }}</span>
            </template>
            <template v-else-if="column.key === 'type'">
              <a-tag v-if="record.type === 'match'" color="success">相符</a-tag>
              <a-tag v-else-if="record.type === 'surplus'" color="geekblue">盘盈</a-tag>
              <a-tag v-else-if="record.type === 'loss'" color="error">盘亏</a-tag>
              <a-tag v-else color="warning">未盘</a-tag>
            </template>
            <template v-else-if="column.key === 'confirm'">
              <template v-if="record.type === 'surplus' || record.type === 'loss'">
                <a-popconfirm
                  v-if="!record.confirmed"
                  title="确认该条差异？"
                  ok-text="确认"
                  cancel-text="取消"
                  :disabled="readonly"
                  @confirm="store.confirmDiff(taskId, record.bookId)"
                >
                  <a-button size="small" type="primary" ghost :disabled="readonly">确认</a-button>
                </a-popconfirm>
                <a-space v-else>
                  <a-tag color="success">已确认</a-tag>
                  <a-button
                    v-if="!readonly"
                    type="link"
                    size="small"
                    @click="store.unconfirmDiff(taskId, record.bookId)"
                  >
                    撤销
                  </a-button>
                </a-space>
              </template>
              <span v-else class="confirm-none">—</span>
            </template>
            <template v-else-if="column.key === 'note'">
              <a-input
                v-if="record.type === 'surplus' || record.type === 'loss'"
                :value="record.note"
                :disabled="readonly"
                placeholder="差异原因备注"
                size="small"
                @blur="e => saveNote(record, e.target.value)"
                @press-enter="e => saveNote(record, e.target.value)"
              />
              <span v-else class="confirm-none">—</span>
            </template>
          </template>
        </a-table>

        <!-- 操作日志 -->
        <a-collapse v-if="task.importLog.length" class="log-panel" ghost>
          <a-collapse-panel key="log" :header="`操作日志（${task.importLog.length}）`">
            <div class="log-list">
              <div
                v-for="(entry, idx) in [...task.importLog].reverse()"
                :key="idx"
                class="log-item"
              >
                <a-badge :status="entry.type === 'warning' ? 'warning' : 'processing'" />
                <span class="log-time">{{ entry.time }}</span>
                <span class="log-message">{{ entry.message }}</span>
              </div>
            </div>
          </a-collapse-panel>
        </a-collapse>
      </div>

      <!-- 导入弹窗 -->
      <ImportResultModal
        v-model:open="importVisible"
        :task-id="taskId"
        @imported="onImported"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  ArrowLeftOutlined,
  ImportOutlined,
  DownloadOutlined,
  CheckOutlined,
  RollbackOutlined,
  SearchOutlined
} from '@ant-design/icons-vue'
import { useInventoryCheckStore } from '@/stores/inventoryCheck'
import ImportResultModal from './ImportResultModal.vue'

const route = useRoute()
const store = useInventoryCheckStore()

const taskId = Number(route.params.id)
const importVisible = ref(false)
const diffFilter = ref('all')
const keyword = ref('')

const task = computed(() => store.getTaskById(taskId))
const readonly = computed(() => task.value?.status === 'completed')
const diffs = computed(() => store.getTaskDiffs(taskId))
const stats = computed(() => store.getTaskStats(taskId))

const columns = [
  { title: '馆藏条目', key: 'book', width: 280 },
  { title: '位置', dataIndex: 'location', key: 'location', width: 100 },
  { title: '系统库存', key: 'systemQty', width: 90 },
  { title: '实盘数量', key: 'actualQty', width: 120 },
  { title: '差异', key: 'diff', width: 80 },
  { title: '判定', key: 'type', width: 90 },
  { title: '差异确认', key: 'confirm', width: 130 },
  { title: '备注', key: 'note' }
]

const filteredDiffs = computed(() => {
  let list = diffs.value
  if (diffFilter.value === 'diff') {
    list = list.filter(d => d.type === 'surplus' || d.type === 'loss')
  } else if (diffFilter.value === 'unchecked') {
    list = list.filter(d => d.type === 'unchecked')
  } else if (diffFilter.value === 'unconfirmed') {
    list = list.filter(d => (d.type === 'surplus' || d.type === 'loss') && !d.confirmed)
  } else if (diffFilter.value === 'deleted') {
    list = list.filter(d => d.deleted)
  }
  if (keyword.value) {
    const kw = keyword.value.toLowerCase()
    list = list.filter(d =>
      d.title.toLowerCase().includes(kw) || d.isbn.toLowerCase().includes(kw)
    )
  }
  return list
})

function rowClassName(record) {
  if (record.deleted) return 'row-deleted'
  if (record.type === 'loss') return 'row-loss'
  if (record.type === 'surplus') return 'row-surplus'
  return ''
}

// 手工录入实盘数量；清空则回到未盘状态
function onActualChange(record, val) {
  if (val === null || val === undefined) {
    store.clearResult(taskId, record.bookId)
  } else {
    store.setManualResult(taskId, record.bookId, val)
  }
}

function saveNote(record, value) {
  if (value !== record.note) {
    store.setReviewNote(taskId, record.bookId, value)
  }
}

function handleFillZero() {
  const count = store.fillUncheckedWithZero(taskId)
  if (count > 0) {
    message.success(`已将 ${count} 个未盘条目按实盘 0 处理`)
  }
}

function handleConfirmAll() {
  const count = store.confirmAllDiffs(taskId)
  if (count > 0) {
    message.success(`已确认 ${count} 条盘点差异`)
  }
}

function handleComplete() {
  Modal.confirm({
    title: '完成盘点任务',
    content: '完成后任务将转为只读归档状态（可随时回退）。系统库存与借阅记录不会被修改。确定完成吗？',
    okText: '完成任务',
    cancelText: '取消',
    onOk: () => {
      const result = store.completeTask(taskId)
      if (result.ok) {
        message.success('盘点任务已完成，结果已归档（系统库存与借阅记录未受影响）')
      } else {
        Modal.warning({
          title: '暂不能完成任务',
          content: result.reason
        })
      }
    }
  })
}

function handleReopen() {
  if (store.reopenTask(taskId)) {
    message.success('任务已回退为进行中，实盘结果与确认状态已保留')
  }
}

function onImported(summary) {
  if (summary.interrupted) {
    message.warning('导入已中断，已导入的结果全部保留，可继续导入')
  } else {
    message.success('实盘结果导入完成，盘点差异已更新')
  }
}

// ========================================
// 导出差异报告（CSV）
// ========================================
function csvCell(value) {
  const str = String(value ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

const TYPE_TEXT = { match: '相符', surplus: '盘盈', loss: '盘亏', unchecked: '未盘' }

function exportReport() {
  const header = ['任务编号', '任务名称', 'ISBN', '书名', '位置', '系统库存', '实盘数量', '差异', '判定', '条目状态', '确认状态', '备注']
  const lines = diffs.value.map(d => [
    task.value.code,
    task.value.name,
    d.isbn,
    d.title,
    d.location,
    d.systemQty,
    d.actualQty === null ? '' : d.actualQty,
    d.diff === null ? '' : d.diff,
    TYPE_TEXT[d.type],
    d.deleted ? '已删除' : '正常',
    (d.type === 'surplus' || d.type === 'loss') ? (d.confirmed ? '已确认' : '待确认') : '',
    d.note
  ].map(csvCell).join(','))
  const content = [header.map(csvCell).join(','), ...lines].join('\n')
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `盘点差异报告_${task.value.code}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
  message.success('差异报告已导出')
}
</script>

<style lang="less" scoped>
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.animate-fade-in { animation: fadeIn 0.5s ease-out both; }

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 16px;

  .header-main {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }

  .back-btn {
    margin-top: 4px;
  }

  .title-line {
    display: flex;
    align-items: center;
    gap: 12px;

    .task-title {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
    }
  }

  .task-meta {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    font-size: 13px;
    color: #999;
  }
}

.alerts {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.stats-panel {
  .progress-stat {
    .progress-label {
      font-size: 14px;
      color: rgba(0, 0, 0, 0.45);
      margin-bottom: 4px;
    }
  }
}

.table-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;

  .keyword-input {
    width: 240px;
  }
}

.empty-block {
  padding: 48px 0;
}

.book-cell {
  .book-name {
    font-weight: 500;
    color: #1a1a1a;

    .deleted-tag {
      margin-left: 8px;
    }
  }

  .book-isbn {
    font-size: 12px;
    color: #999;
    margin-top: 2px;
  }
}

.qty {
  font-weight: 500;
}

.actual-input {
  width: 100px;
}

.diff-none { color: #bfbfbf; }
.diff-zero { color: #52c41a; font-weight: 500; }
.diff-plus { color: #1890ff; font-weight: 600; }
.diff-minus { color: #ff4d4f; font-weight: 600; }

.confirm-none { color: #bfbfbf; }

:deep(.row-loss) td {
  background: #fff1f0 !important;
}

:deep(.row-surplus) td {
  background: #f0f5ff !important;
}

:deep(.row-deleted) td {
  background: #fafafa !important;
  color: #999;
}

.log-panel {
  margin-top: 16px;
  border-top: 1px dashed #f0f0f0;

  .log-list {
    max-height: 200px;
    overflow-y: auto;

    .log-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 12px;

      .log-time {
        color: #999;
        flex-shrink: 0;
      }

      .log-message {
        color: #666;
      }
    }
  }
}

.complete-btn {
  background: #52c41a;
  border-color: #52c41a;

  &:hover:not(:disabled) {
    background: #73d13d;
    border-color: #73d13d;
  }
}
</style>
