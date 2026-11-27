<template>
  <el-card shadow="never">
    <template #header>
      <div class="row-gap"><span>员工与角色（固定五档；可新建用户、启停）</span><div style="flex:1" /><el-button type="primary" size="small" @click="openNew">新建用户</el-button></div>
    </template>
    <el-table :data="list" border size="small">
      <el-table-column prop="username" label="账号" width="110" />
      <el-table-column prop="displayName" label="名称" width="160" />
      <el-table-column label="角色" width="100"><template #default="{ row }"><el-tag size="small">{{ ROLE_LABEL[row.role as Role] }}</el-tag></template></el-table-column>
      <el-table-column label="绑定号主档案" width="170"><template #default="{ row }">
        <span v-if="row.role === 'owner'">{{ ownerLabel(row.ownerId) }}</span><span v-else class="muted">—</span></template></el-table-column>
      <el-table-column label="能力" min-width="300"><template #default="{ row }"><span class="muted">{{ ROLE_CAPS[row.role as Role].map((c) => CAP_LABEL[c]).join('、') }}</span></template></el-table-column>
      <el-table-column label="启用" width="80"><template #default="{ row }"><el-switch :model-value="row.enabled" @change="(v: any) => toggle(row, v)" /></template></el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="dlg" title="新建用户" width="520px" class="staff-dialog">
    <el-alert v-if="unsupported" class="staff-unsupported" type="warning" :closable="false" show-icon title="后端暂未支持新建用户" :description="unsupported" style="margin-bottom:12px" />
    <el-form ref="formRef" :model="nf" :rules="rules" label-width="100px">
      <el-form-item label="角色" prop="role">
        <el-select v-model="nf.role" style="width:100%" @change="onRole"><el-option v-for="(l, k) in ROLE_LABEL" :key="k" :label="l" :value="k" /></el-select>
      </el-form-item>
      <el-form-item v-if="nf.role === 'owner'" label="号主档案" prop="ownerId">
        <el-select v-model="nf.ownerId" filterable placeholder="选择未绑定登录的号主档案" style="width:100%" no-data-text="没有未绑定的号主档案" @change="onOwner">
          <el-option v-for="o in freeOwners" :key="o.id" :label="`${o.displayName} · ${o.contact}`" :value="o.id" />
        </el-select>
        <div class="muted" style="font-size:12px;line-height:1.6">一个号主档案只能绑定一个登录（一对一）。档案在寄租账号录入 / 导入时按号主联系方式自动建立。</div>
      </el-form-item>
      <el-form-item label="登录名" prop="username"><el-input v-model="nf.username" placeholder="3–32 位字母、数字或 _ . -" autocomplete="off" /></el-form-item>
      <el-form-item label="名称" prop="displayName"><el-input v-model="nf.displayName" placeholder="显示名称" /></el-form-item>
      <el-form-item label="初始密码" prop="password">
        <el-input v-model="nf.password" type="password" show-password autocomplete="new-password" placeholder="至少 8 位" style="flex:1" />
        <el-button style="margin-left:8px" @click="genPassword">生成</el-button>
      </el-form-item>
      <el-alert v-if="generated" type="info" :closable="false" show-icon :title="`已生成初始密码：${nf.password}`" description="请通过安全渠道告知对方；保存后不会再显示。" />
    </el-form>
    <template #footer><el-button @click="dlg = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!!unsupported" @click="create">创建</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { api } from '../../api'
import { ROLE_CAPS, type Cap } from '../../domain/permissions'
import { ROLE_LABEL, type OwnerProfile, type Role, type StaffCreateInput, type StaffUser } from '../../domain/types'
import { ElMessage } from 'element-plus'
import { ApiError } from '../../api/errors'
import { run } from '../../utils'
const CAP_LABEL: Record<Cap, string> = {
  front: '前台', ownerPortal: '号主门户（本人）', ownerPortalAll: '号主门户（全部）', seeRent: '大厅报价', seeCommission: '租客信息 / 抽成', adminArea: '进后台',
  dashboard: '看板', orders: '订单与台账', recycles: '回收跟进', inventoryView: '库存查看', inventoryEdit: '库存编辑', rulesEdit: '规则与估值依据',
  profiles: '客户档案', reports: '报表', csView: '客服排班', staff: '员工', audit: '操作日志',
}
const list = ref<StaffUser[]>([])
const owners = ref<OwnerProfile[]>([])
const freeOwners = computed(() => owners.value.filter((o) => !o.userId && !list.value.some((u) => u.ownerId === o.id)))
const ownerLabel = (id?: string) => { const o = owners.value.find((x) => x.id === id); return o ? `${o.displayName}（${o.contact}）` : id ? id : '未绑定' }
async function load() { [list.value, owners.value] = await Promise.all([api.listUsers(), api.ownerProfiles()]) }
async function toggle(u: StaffUser, v: boolean) { if (await run(() => api.setUserEnabled(u.username, v), v ? '已启用' : '已停用')) await load() }

const dlg = ref(false), saving = ref(false), generated = ref(false)
/** 后端没实现 POST /staff（契约 x-status: proposed）时的说明；本次会话内记住，不再反复尝试 */
const unsupported = ref('')
const formRef = ref<FormInstance>()
const nf = reactive<StaffCreateInput>({ username: '', displayName: '', role: 'cs', password: '', ownerId: undefined })
const rules: FormRules = {
  role: [{ required: true, message: '请选择角色' }],
  ownerId: [{ validator: (_r, v, cb) => (nf.role === 'owner' && !v ? cb(new Error('号主用户需绑定号主档案')) : cb()) }],
  username: [{ required: true, message: '请填写登录名' }, { pattern: /^[A-Za-z0-9_.-]{3,32}$/, message: '3–32 位字母、数字或 _ . -' }],
  displayName: [{ required: true, message: '请填写名称' }],
  password: [{ required: true, message: '请设置初始密码' }, { min: 8, message: '至少 8 位' }],
}
function openNew() { Object.assign(nf, { username: '', displayName: '', role: 'cs', password: '', ownerId: undefined }); generated.value = false; dlg.value = true; formRef.value?.clearValidate() }
function onRole() { if (nf.role !== 'owner') nf.ownerId = undefined }
function onOwner() { const o = owners.value.find((x) => x.id === nf.ownerId); if (o && !nf.displayName) nf.displayName = `${o.displayName}（号主）` }
function genPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const b = new Uint8Array(12); crypto.getRandomValues(b)
  nf.password = [...b].map((x) => abc[x % abc.length]).join('')
  generated.value = true
}
async function create() {
  if (!(await formRef.value?.validate().catch(() => false))) return
  saving.value = true
  try {
    await api.createUser({ ...nf, username: nf.username.trim(), displayName: nf.displayName.trim(), ...(nf.role === 'owner' ? {} : { ownerId: undefined }) })
    ElMessage.success('已创建')
    dlg.value = false
    await load()
  } catch (e) {
    if (e instanceof ApiError && e.errorCode === 'NOT_SUPPORTED') unsupported.value = e.message
    else ElMessage.error(e instanceof Error ? e.message : String(e))
  } finally { saving.value = false }
}
onMounted(load)
</script>
