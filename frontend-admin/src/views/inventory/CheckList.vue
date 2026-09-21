<template>
  <div class="check-list">
    <h2 class="page-title animate-fade-in">馆藏盘点</h2>

    <!-- 统计卡片 -->
    <a-row :gutter="[16, 16]" class="stat-row">
      <a-col :xs="24" :sm="12" :lg="6">
        <div class="stat-card animate-slide-up" style="animation-delay: 0.05s">
          <div class="stat-icon"><AuditOutlined /></div>
          <div class="stat-info">
            <div class="stat-value">{{ store.totalTasks }}</div>
            <div class="stat-label">盘点任务</div>
          </div>
          <div class="stat-card-bg"></div>
        </div>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <div class="stat-card warning animate-slide-up" style="animation-delay: 0.15s">
          <div class="stat-icon"><SyncOutlined /></div>
          <div class="stat-info">
            <div class="stat-value">{{ store.inProgressCount }}</div>
            <div class="stat-label">进行中</div>
          </div>
          <div class="stat-card-bg"></div>
        </div>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <div class="stat-card success animate-slide-up" style="animation-delay: 0.25s">
          <div class="stat-icon"><CheckCircleOutlined /></div>
          <div class="stat-info">
            <div class="stat-value">{{ store.completedCount }}</div>
            <div class="stat-label">已完成</div>
          </div>
          <div class="stat-card-bg"></div>
        </div>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <div class="stat-card error animate-slide-up" style="animation-delay: 0.35s">
          <div class="stat-icon"><ExclamationCircleOutlined /></div>
          <div class="stat-info">
            <div class="stat-value">{{ store.pendingConfirmCount }}</div>
            <div class="stat-label">待确认差异</div>
          </div>
          <div class="stat-card-bg"></div>
        </div>
      </a-col>
    </a-row>

    <!-- 搜索区域 -->
    <div class="search-area animate-slide-down">
      <a-row :gutter="16" align="middle">
        <a-col :xs="24" :sm="12" :md="8" :lg="6">
          <a-input
            v-model:value="searchKeyword"
            placeholder="搜索任务名称、编号"
            allow-clear
          >
            <template #suffix>
              <SearchOutlined class="search-icon" />
            </template>
          </a-input>
        </a-col>
        <a-col :xs="24" :sm="12" :md="8" :lg="6">
          <a-select
            v-model:value="statusFilter"
            placeholder="任务状态"
            allow-clear
            style="width: 100%"
          >
            <a-select-option value="in_progress">进行中</a-select-option>
            <a-select-option value="completed">已完成</a-select-option>
          </a-select>
        </a-col>
        <a-col :xs="24" :sm="24" :md="8" :lg="12" style="text-align: right;">
          <a-button type="primary" @click="showCreateModal">
            <PlusOutlined /> 新建盘点任务
          </a-button>
        </a-col>
      </a-row>
    </div>

    <!-- 任务表格 -->
    <div class="table-container animate-fade-in">
      <a-table
        :columns="columns"
        :data-source="filteredTasks"
        row-key="id"
        :pagination="{ pageSize: 10, showTotal: total => `共 ${total} 条` }"
        :locale="{ emptyText: emptyText }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'task'">
            <div class="task-cell">
              <div class="task-name" @click="goDetail(record.id)">{{ record.name }}</div>
              <div class="task-code">{{ record.code }}</div>
            </div>
          </template>
          <template v-else-if="column.key === 'scope'">
            <a-tag color="blue">{{ record.categoryName }}</a-tag>
          </template>
          <template v-else-if="column.key === 'progress'">
            <div class="progress-cell">
              <span class="progress-num">{{ statsOf(record).checked }} / {{ statsOf(record).total }}</span>
              <a-progress
                :percent="statsOf(record).progress"
                :show-info="false"
                size="small"
                :stroke-color="record.status === 'completed' ? '#52c41a' : '#1890ff'"
              />
            </div>
          </template>
          <template v-else-if="column.key === 'diff'">
            <template v-if="statsOf(record).surplus || statsOf(record).loss">
              <a-tag v-if="statsOf(record).surplus" color="geekblue">盈 {{ statsOf(record).surplus }}</a-tag>
              <a-tag v-if="statsOf(record).loss" color="red">亏 {{ statsOf(record).loss }}</a-tag>
              <a-tag v-if="statsOf(record).unconfirmedDiffs" color="orange">
                待确认 {{ statsOf(record).unconfirmedDiffs }}
              </a-tag>
            </template>
            <span v-else class="no-diff">无差异</span>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-badge
              :status="record.status === 'completed' ? 'success' : 'processing'"
              :text="record.status === 'completed' ? '已完成' : '进行中'"
            />
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a-button type="link" size="small" @click="goDetail(record.id)">
                <EyeOutlined /> {{ record.status === 'completed' ? '查看' : '盘点' }}
              </a-button>
              <a-popconfirm
                v-if="record.status === 'completed'"
                title="回退后任务恢复为进行中，实盘结果与确认状态将保留。确定回退？"
                ok-text="确定"
                cancel-text="取消"
                @confirm="handleReopen(record)"
              >
                <a-button type="link" size="small">
                  <RollbackOutlined /> 回退
                </a-button>
              </a-popconfirm>
              <a-popconfirm
                title="确定要删除该盘点任务吗？任务数据删除后不可恢复。"
                ok-text="确定"
                cancel-text="取消"
                @confirm="handleDelete(record.id)"
              >
                <a-button type="link" size="small" danger>
                  <DeleteOutlined /> 删除
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <!-- 新建任务弹窗 -->
    <a-modal
      v-model:open="createVisible"
      title="新建盘点任务"
      :confirm-loading="creating"
      ok-text="创建"
      cancel-text="取消"
      @ok="handleCreate"
      @cancel="handleCreateClose"
    >
      <a-alert
        type="info"
        show-icon
        class="create-tip"
        message="创建后将按当前系统库存生成盘点快照，盘点过程不会修改系统库存与借阅记录。"
      />
      <a-form
        ref="formRef"
        :model="formState"
        :rules="formRules"
        :label-col="{ span: 5 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="任务名称" name="name">
          <a-input v-model:value="formState.name" placeholder="如：2026年第三季度馆藏盘点" />
        </a-form-item>
        <a-form-item label="盘点范围" name="scope">
          <a-radio-group v-model:value="formState.scope">
            <a-radio value="all">全部馆藏</a-radio>
            <a-radio value="category">按分类</a-radio>
          </a-radio-group>
        </a-form-item>
        <a-form-item
          v-if="formState.scope === 'category'"
          label="选择分类"
          name="categoryId"
        >
          <a-select v-model:value="formState.categoryId" placeholder="请选择分类">
            <a-select-option
              v-for="cat in categoryStore.categories"
              :key="cat.id"
              :value="cat.id"
            >
              {{ cat.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="备注" name="remark">
          <a-textarea v-model:value="formState.remark" :rows="3" placeholder="选填" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  PlusOutlined,
  SearchOutlined,
  EyeOutlined,
  DeleteOutlined,
  RollbackOutlined,
  AuditOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons-vue'
import { useInventoryCheckStore } from '@/stores/inventoryCheck'
import { useCategoryStore } from '@/stores/category'

const router = useRouter()
const store = useInventoryCheckStore()
const categoryStore = useCategoryStore()

const searchKeyword = ref('')
const statusFilter = ref(null)
const createVisible = ref(false)
const creating = ref(false)
const formRef = ref(null)

const columns = [
  { title: '盘点任务', key: 'task', width: 260 },
  { title: '盘点范围', key: 'scope', width: 110 },
  { title: '盘点进度', key: 'progress', width: 180 },
  { title: '盘点差异', key: 'diff', width: 220 },
  { title: '状态', key: 'status', width: 100 },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 160 },
  { title: '操作', key: 'action', width: 220, fixed: 'right' }
]

const emptyText = '暂无盘点任务，点击右上角「新建盘点任务」开始'

const formState = reactive({
  name: '',
  scope: 'all',
  categoryId: null,
  remark: ''
})

const formRules = {
  name: [{ required: true, message: '请输入任务名称' }],
  categoryId: [{ required: true, message: '请选择分类' }]
}

const filteredTasks = computed(() => {
  let result = [...store.tasks].sort((a, b) => b.id - a.id)
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    result = result.filter(t =>
      t.name.toLowerCase().includes(keyword) ||
      t.code.toLowerCase().includes(keyword)
    )
  }
  if (statusFilter.value) {
    result = result.filter(t => t.status === statusFilter.value)
  }
  return result
})

function statsOf(task) {
  return store.getTaskStats(task.id)
}

function goDetail(id) {
  router.push(`/inventory/${id}`)
}

function showCreateModal() {
  Object.assign(formState, { name: '', scope: 'all', categoryId: null, remark: '' })
  createVisible.value = true
  nextTick(() => {
    formRef.value?.clearValidate()
  })
}

function handleCreateClose() {
  nextTick(() => {
    formRef.value?.resetFields()
  })
}

async function handleCreate() {
  try {
    await formRef.value.validate()
  } catch (e) {
    return
  }
  // 重复盘点提醒：存在同范围进行中任务时需二次确认
  const overlapping = store.findOverlappingTask(formState.scope, formState.categoryId)
  if (overlapping) {
    Modal.confirm({
      title: '存在进行中的同范围盘点任务',
      content: `任务「${overlapping.name}」（${overlapping.code}）仍在进行中，重复创建可能导致重复盘点。确定继续创建吗？`,
      okText: '继续创建',
      cancelText: '取消',
      onOk: () => doCreate()
    })
  } else {
    doCreate()
  }
}

function doCreate() {
  creating.value = true
  const id = store.createTask({ ...formState })
  const task = store.getTaskById(id)
  creating.value = false
  createVisible.value = false
  if (task && task.snapshot.length === 0) {
    message.warning('该盘点范围内暂无馆藏条目，已创建空盘点任务')
  } else {
    message.success('盘点任务创建成功')
  }
  router.push(`/inventory/${id}`)
}

function handleReopen(record) {
  if (store.reopenTask(record.id)) {
    message.success(`任务「${record.name}」已回退为进行中，确认状态已保留`)
  }
}

function handleDelete(id) {
  store.deleteTask(id)
  message.success('盘点任务已删除')
}
</script>

<style lang="less" scoped>
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.animate-fade-in { animation: fadeIn 0.5s ease-out both; }
.animate-slide-down { animation: slideDown 0.5s ease-out both; }
.animate-slide-up { animation: slideUp 0.5s ease-out both; }

.stat-row {
  margin-bottom: 16px;
}

.stat-card {
  position: relative;
  display: flex;
  align-items: center;
  overflow: hidden;

  .stat-icon {
    width: 52px;
    height: 52px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26px;
    margin-right: 16px;
    flex-shrink: 0;
  }

  .stat-info {
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
    }

    .stat-label {
      font-size: 13px;
      opacity: 0.9;
    }
  }

  .stat-card-bg {
    position: absolute;
    right: -20px;
    top: -20px;
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.1);
  }
}

.search-area {
  .search-icon {
    color: rgba(0, 0, 0, 0.45);
  }
}

.task-cell {
  .task-name {
    font-weight: 500;
    color: #1a1a1a;
    cursor: pointer;
    transition: color 0.3s ease;

    &:hover {
      color: #1890ff;
    }
  }

  .task-code {
    font-size: 12px;
    color: #999;
    margin-top: 2px;
  }
}

.progress-cell {
  .progress-num {
    font-size: 12px;
    color: #666;
    display: block;
    margin-bottom: 2px;
  }
}

.no-diff {
  color: #52c41a;
  font-size: 13px;
}

.create-tip {
  margin-bottom: 16px;
}
</style>
