<template>
  <div class="page" v-if="a">
    <el-page-header @back="$router.back()" :content="`账号详情 · ${a.accountNo}`" style="margin-bottom:12px" />
    <el-alert v-if="a.status !== 'listed'" type="warning" show-icon :closable="false" style="margin-bottom:12px"
      :title="`该账号当前为「${ACCOUNT_STATUS_LABEL[a.status]}」，暂不可租，请重新选择`" />
    <el-row :gutter="16">
      <el-col :span="16">
        <el-card shadow="never" header="资产信息">
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="编号">{{ a.accountNo }} <el-button link type="primary" @click="copy(a.accountNo)">复制</el-button></el-descriptions-item>
            <el-descriptions-item label="状态"><el-tag :type="statusTagType[a.status]" size="small">{{ ACCOUNT_STATUS_LABEL[a.status] }}</el-tag></el-descriptions-item>
            <el-descriptions-item label="大区">{{ a.region || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="登录方式">{{ a.loginMethod || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="上架渠道">{{ a.channel || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="辅助上号时段">{{ a.assistTime || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="纯币">{{ a.coinAmount }} M</el-descriptions-item>
            <el-descriptions-item label="总资产">{{ a.totalAssets }} M</el-descriptions-item>
            <el-descriptions-item label="比例">1 : {{ a.coinRatio }}</el-descriptions-item>
            <el-descriptions-item label="等级">{{ a.level }}</el-descriptions-item>
            <el-descriptions-item label="段位">{{ a.rank || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="绝密 KD">{{ a.secretKd }}</el-descriptions-item>
            <el-descriptions-item label="保险格数">{{ a.safeBox }} 格</el-descriptions-item>
            <el-descriptions-item label="体力">{{ a.stamina || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="负重">{{ a.load || '未配置' }}</el-descriptions-item>
            <el-descriptions-item label="AWM">{{ a.awmCount }}</el-descriptions-item>
            <el-descriptions-item label="6 头">{{ a.helmet6Count }}</el-descriptions-item>
            <el-descriptions-item label="6 甲">{{ a.armor6Count }}</el-descriptions-item>
            <el-descriptions-item label="九格体验卡">{{ a.experienceCardCount }}</el-descriptions-item>
            <el-descriptions-item label="封禁记录">{{ a.banRecord ? '有' : '无' }}</el-descriptions-item>
            <el-descriptions-item label="周期">{{ a.cycle }}</el-descriptions-item>
            <el-descriptions-item label="备注" :span="3">{{ a.remark || '—' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
        <el-card shadow="never" style="margin-top:12px">
          <template #header>全部皮肤（{{ a.skins.length }}）</template>
          <el-tag v-for="s in a.skins" :key="s" style="margin:3px">{{ s }} · {{ skinCategory(s) }}</el-tag>
          <span v-if="!a.skins.length" class="muted">无皮肤</span>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card v-if="!a.quote" shadow="never" header="报价">
          <p class="muted">号主视图不展示租金与抽成。若这是你的账号，请到「我的账号」查看状态与到手金额。</p>
          <el-button type="warning" style="width:100%" :disabled="a.status !== 'listed'" @click="dlg = true">联系客服</el-button>
        </el-card>
        <el-card v-else shadow="never" header="报价明细">
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="原纯币租金">{{ a.quote!.originalCoinRent }} 元</el-descriptions-item>
            <el-descriptions-item label="折扣">{{ a.quote!.discountPercent }}{{ a.quote!.tierHit ? `（${a.quote!.tierHit}）` : '' }}</el-descriptions-item>
            <el-descriptions-item label="纯币租金">{{ a.quote!.coinRent }} 元</el-descriptions-item>
            <el-descriptions-item label="附加服务费">{{ a.quote!.extraFee }} 元</el-descriptions-item>
            <el-descriptions-item label="押金">{{ a.quote!.deposit }} 元</el-descriptions-item>
            <el-descriptions-item label="总金额"><span class="money">¥{{ a.quote!.totalAmount }}</span></el-descriptions-item>
            <el-descriptions-item label="租期">{{ a.quote!.rentalDays }} 天</el-descriptions-item>
          </el-descriptions>
          <el-alert type="info" :closable="false" style="margin-top:10px" title="AWM / 6头 / 6甲按实际使用从押金扣除。" />
          <el-button type="warning" style="width:100%;margin-top:12px" :disabled="a.status !== 'listed'" @click="dlg = true">联系客服下单</el-button>
        </el-card>
      </el-col>
    </el-row>
    <ContactDialog v-model="dlg" :account-no="a.accountNo" />
  </div>
  <el-empty v-else-if="loaded" description="账号不存在"><el-button @click="$router.push('/accounts')">返回大厅</el-button></el-empty>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api'
import { skinCategoryOf as skinCategory } from '../../config/dictStore'
import { ACCOUNT_STATUS_LABEL, type LobbyAccount as Account } from '../../domain/types'
import { copy, statusTagType } from '../../utils'
import ContactDialog from '../../components/ContactDialog.vue'
const route = useRoute()
const a = ref<Account>()
const loaded = ref(false)
const dlg = ref(false)
onMounted(async () => { a.value = await api.getAccount(route.params.id as string); loaded.value = true })
</script>
