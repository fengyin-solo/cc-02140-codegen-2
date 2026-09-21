<template>
  <a-modal
    :open="open"
    title="导入实盘结果"
    width="640px"
    :mask-closable="!importing"
    :closable="!importing"
    :footer="null"
    @cancel="handleClose"
  >
    <!-- 上次导入中断提示：已导入结果保留，可继续 -->
    <a-alert
      v-if="task && task.importState === 'interrupted' && !importing && !summary"
      type="warning"
      show-icon
      class="interrupt-alert"
      :message="`上次导入被中断，已保留 ${task.results.length} 条实盘结果`"
      description="重新粘贴或上传实盘数据继续导入即可，已导入的结果会被覆盖更新，不会丢失。"
    />

    <template v-if="!importing && !summary">
      <a-tabs v-model:activeKey="activeTab">
        <a-tab-pane key="paste" tab="粘贴文本">
          <a-textarea
            v-model:value="importText"
            :rows="10"
            placeholder="每行一条实盘记录，支持两种格式：&#10;ISBN,实盘数量&#10;ISBN,书名,实盘数量&#10;&#10;示例：&#10;978-7-02-008179-4,10&#10;978-7-111-40701-0,JavaScript高级程序设计,8"
          />
        </a-tab-pane>
        <a-tab-pane key="file" tab="上传文件">
          <a-upload-dragger
            :before-upload="handleFile"
            :show-upload-list="false"
            accept=".csv,.txt"
          >
            <p class="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p class="ant-upload-text">点击或拖拽 CSV / TXT 文件到此区域</p>
            <p class="ant-upload-hint">文件内容将被读入「粘贴文本」页签，确认无误后开始导入</p>
          </a-upload-dragger>
        </a-tab-pane>
      </a-tabs>

      <div class="import-tips">
        <div class="tip-item">· 重复盘点同一条目时以最后一条为准，并记入日志</div>
        <div class="tip-item">· 无效行、范围外条目自动跳过，不会中断整体导入</div>
        <div class="tip-item">· 导入过程分块落库，中断时已导入结果全部保留</div>
      </div>

      <div class="modal-actions">
        <a-button @click="downloadTemplate">
          <DownloadOutlined /> 下载导入模板
        </a-button>
        <a-button type="primary" :disabled="!importText.trim()" @click="startImport">
          <ImportOutlined /> 开始导入
        </a-button>
      </div>
    </template>

    <!-- 导入中：进度 + 可中断 -->
    <template v-else-if="importing">
      <div class="importing-panel">
        <a-progress
          :percent="progressPercent"
          :status="cancelling ? 'exception' : 'active'"
          :stroke-color="{ from: '#1890ff', to: '#52c41a' }"
        />
        <div class="progress-text">
          {{ cancelling ? '正在中断…' : `正在导入 ${progress.done} / ${progress.total} 行，结果已分块保存` }}
        </div>
        <a-button danger :disabled="cancelling" @click="cancelImport">
          中断导入（已导入部分将保留）
        </a-button>
      </div>
    </template>

    <!-- 导入结果汇总 -->
    <template v-else>
      <a-result
        :status="summary.interrupted ? 'warning' : 'success'"
        :title="summary.interrupted ? '导入已中断，结果已保留' : '导入完成'"
        :sub-title="summary.interrupted
          ? `已处理 ${summary.processed}/${summary.total} 行，已导入的实盘结果全部保留，可继续导入`
          : `共处理 ${summary.total} 行实盘数据`"
      >
        <template #extra>
          <div class="summary-tags">
            <a-tag color="success">新增 {{ summary.added }}</a-tag>
            <a-tag color="processing">覆盖 {{ summary.updated }}</a-tag>
            <a-tag v-if="summary.duplicated" color="warning">重复合并 {{ summary.duplicated }}</a-tag>
            <a-tag v-if="summary.invalid" color="error">无效 {{ summary.invalid }}</a-tag>
            <a-tag v-if="summary.outOfScope" color="error">范围外 {{ summary.outOfScope }}</a-tag>
          </div>
          <a-button type="primary" @click="handleFinish">查看盘点差异</a-button>
          <a-button v-if="summary.interrupted" @click="resetImport">继续导入</a-button>
        </template>
      </a-result>
    </template>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import { ImportOutlined, DownloadOutlined, InboxOutlined } from '@ant-design/icons-vue'
import { useInventoryCheckStore } from '@/stores/inventoryCheck'

const props = defineProps({
  open: { type: Boolean, default: false },
  taskId: { type: Number, required: true }
})
const emit = defineEmits(['update:open', 'imported'])

const store = useInventoryCheckStore()

const activeTab = ref('paste')
const importText = ref('')
const importing = ref(false)
const cancelling = ref(false)
const progress = ref({ done: 0, total: 0 })
const summary = ref(null)

const task = computed(() => store.getTaskById(props.taskId))
const progressPercent = computed(() =>
  progress.value.total === 0 ? 0 : Math.round((progress.value.done / progress.value.total) * 100)
)

// 弹窗重新打开时重置为编辑状态（保留中断提示）
watch(() => props.open, (open) => {
  if (open) {
    summary.value = null
    importing.value = false
    cancelling.value = false
  }
})

function handleFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    importText.value = String(reader.result || '')
    activeTab.value = 'paste'
    message.success(`已读取文件「${file.name}」，请确认内容后开始导入`)
  }
  reader.onerror = () => {
    message.error('文件读取失败，请重试')
  }
  reader.readAsText(file)
  return false // 阻止自动上传
}

async function startImport() {
  const rows = store.parseImportText(importText.value)
  if (rows.length === 0) {
    message.warning('未解析到有效数据，请检查格式（ISBN,实盘数量）')
    return
  }
  importing.value = true
  cancelling.value = false
  progress.value = { done: 0, total: rows.length }

  const result = await store.importResults(props.taskId, rows, {
    onProgress: (done, total) => {
      progress.value = { done, total }
    },
    isCancelled: () => cancelling.value
  })

  importing.value = false
  if (result.ok) {
    summary.value = result.summary
    emit('imported', result.summary)
  } else {
    message.error(result.reason || '导入失败')
  }
}

function cancelImport() {
  cancelling.value = true
}

function resetImport() {
  summary.value = null
  importText.value = ''
}

function handleFinish() {
  emit('update:open', false)
}

function handleClose() {
  if (importing.value) return
  emit('update:open', false)
}

function downloadTemplate() {
  if (!task.value) return
  const header = 'ISBN,书名,系统库存,实盘数量'
  const lines = task.value.snapshot.map(s => `${s.isbn},${s.title},${s.systemQty},`)
  downloadCsv(`盘点模板_${task.value.code}.csv`, [header, ...lines].join('\n'))
  message.success('模板已下载，填写「实盘数量」列后导入')
}

function downloadCsv(filename, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
</script>

<style lang="less" scoped>
.interrupt-alert {
  margin-bottom: 16px;
}

.import-tips {
  margin-top: 12px;
  padding: 12px 16px;
  background: #fafbfc;
  border-radius: 8px;
  border: 1px dashed #e8e8e8;

  .tip-item {
    font-size: 12px;
    color: #999;
    line-height: 1.8;
  }
}

.modal-actions {
  margin-top: 16px;
  display: flex;
  justify-content: space-between;
}

.importing-panel {
  padding: 24px 8px;
  text-align: center;

  .progress-text {
    margin: 16px 0;
    color: #666;
    font-size: 13px;
  }
}

.summary-tags {
  margin-bottom: 16px;
  display: flex;
  justify-content: center;
  gap: 4px;
  flex-wrap: wrap;
}
</style>
