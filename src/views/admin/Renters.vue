<template>
  <el-card shadow="never">
    <div class="row-gap" style="margin-bottom:12px">
      <el-select v-model="tag" placeholder="全部标签" clearable style="width:120px">
        <el-option v-for="(l, k) in RENTER_TAG_LABEL" :key="k" :label="l" :value="k" />
        <el-option label="无标签" value="none" />
      </el-select>
      <el-input v-model="kw" placeholder="联系方式 / 昵称" clearable style="width:220px" />
      <span class="muted">以联系方式（微信号）为唯一标识，自动汇总订单。熟客优惠在「规则」里配置。</span>
      <div style="flex:1" />
      <el-button type="primary" @click="openEdit()">新建档案 / 打标签</el-button>
    </div>
    <el-table :data="rows" border size="small">
      <el-table-column prop="contact" label="联系方式" width="160" />
      <el-table-column prop="displayName" label="昵称" width="90" />
      <el-table-column label="标签" width="90"><template #default="{ row }"><el-tag v-if="row.tag" size="small" :type="tagType[row.tag as RenterTag]">{{ RENTER_TAG_LABEL[row.tag as RenterTag] }}</el-tag><span v-else class="muted">—</span></template></el-table-column>
      <el-table-column prop="rentalCount" label="租过次数" width="80" />
      <el-table-column label="总消费" width="80"><template #default="{ row }">¥{{ row.totalSpend }}</template></el-table-column>
      <el-table-column prop="depositDeductCount" label="扣过押金" width="80" />
      <el-table-column label="最近租用" width="140"><template #default="{ row }">{{ fmtTime(row.lastRentAt) }}</template></el-table-column>
      <el-table-column prop="note" label="备注" min-width="140" show-overflow-tooltip />
      <el-table-column label="操作" width="150"><template #default="{ row }">
        <el-button link type="primary" @click="openEdit(row)">打标签</el-button>
        <el-button link @click="$router.push(`/admin/orders?kw=${row.contact}`)">订单</el-button></template></el-table-column>
    </el-table>
  </el-card>
  <el-dialog v-model="dlg" title="租客档案" width="460px">
    <el-form label-width="80px">
      <el-form-item label="联系方式"><el-input v-model="f.contact" :disabled="editing" /></el-form-item>
      <el-form-item label="昵称"><el-input v-model="f.displayName" /></el-form-item>
      <el-form-item label="标签"><el-radio-group v-model="f.tag"><el-radio :value="null">无</el-radio><el-radio v-for="(l, k) in RENTER_TAG_LABEL" :key="k" :value="k">{{ l }}</el-radio></el-radio-group></el-form-item>
      <el-form-item label="备注"><el-input v-model="f.note" type="textarea" placeholder="如：恶意消耗物资（黑名单会在登记订单时展示原因）" /></el-form-item>
    </el-form>
    <template #footer><el-button @click="dlg = false">取消</el-button><el-button type="primary" @click="save">保存</el-button></template>
  </el-dialog>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '../../api'
import { RENTER_TAG_LABEL, type RenterProfile, type RenterTag } from '../../domain/types'
import { fmtTime, run } from '../../utils'
const list = ref<RenterProfile[]>([])
const tag = ref('')
const kw = ref('')
const tagType: Record<RenterTag, 'success' | 'warning' | 'danger'> = { regular: 'success', caution: 'warning', blacklist: 'danger' }
const rows = computed(() => list.value.filter((r) => (!tag.value || (tag.value === 'none' ? !r.tag : r.tag === tag.value)) &&
  (!kw.value || r.contact.toLowerCase().includes(kw.value.toLowerCase()) || r.displayName.includes(kw.value))))
const dlg = ref(false)
const editing = ref(false)
const f = reactive({ contact: '', displayName: '', tag: null as RenterTag | null, note: '' })
function openEdit(r?: RenterProfile) {
  editing.value = !!r
  Object.assign(f, r ? { contact: r.contact, displayName: r.displayName, tag: r.tag, note: r.note } : { contact: '', displayName: '', tag: null, note: '' })
  dlg.value = true
}
async function save() { if (await run(() => api.saveRenter({ ...f }), '已保存')) { dlg.value = false; await load() } }
async function load() { list.value = await api.renterProfiles() }
onMounted(load)
</script>
