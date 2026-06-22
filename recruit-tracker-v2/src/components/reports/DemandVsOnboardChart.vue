<script setup>
/* 月度需求 vs 入职 + 达成率 */

import { ref, watch, onMounted, nextTick } from 'vue';
import { Chart, BarController, LineController, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend } from 'chart.js';

Chart.register(BarController, LineController, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend);

const props = defineProps({
  data: { type: Object, default: null },
});

const canvas = ref(null);
let chart = null;

function renderChart() {
  if (!canvas.value || !props.data?.months?.length) return;
  if (chart) chart.destroy();

  const months = props.data.months;
  chart = new Chart(canvas.value, {
    type: 'bar',
    data: {
      labels: months.map(m => m.month),
      datasets: [
        {
          label: '需求人数',
          data: months.map(m => m.headcount),
          backgroundColor: 'rgba(123,168,224,0.6)',
          borderColor: '#7BA8E0',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          label: '入职人数',
          data: months.map(m => m.onboarded),
          backgroundColor: 'rgba(61,175,110,0.6)',
          borderColor: '#3DAF6E',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
        },
        {
          label: '达成率 %',
          data: months.map(m => m.achievementRate),
          type: 'line',
          borderColor: '#F0B828',
          backgroundColor: 'rgba(240,184,40,0.1)',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#F0B828',
          tension: 0.3,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        title: { display: true, text: '月度招聘需求 vs 入职', font: { size: 14, weight: '600' }, color: '#4A4A4A' },
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 11 } } },
      },
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: '人数', color: '#999' },
          ticks: { stepSize: 1 },
          beginAtZero: true,
        },
        y1: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: '达成率 %', color: '#F0B828' },
          min: 0,
          max: 100,
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

watch(() => props.data, async () => { await nextTick(); renderChart(); });
onMounted(async () => { await nextTick(); renderChart(); });
</script>

<template>
  <div class="dvoc">
    <div class="card chart-card">
      <canvas ref="canvas" height="300"></canvas>
    </div>
    <!-- 数据表 -->
    <div v-if="data?.months?.length" class="dvoc-table-wrap">
      <table class="dvoc-table">
        <thead>
          <tr><th>月份</th><th>需求数</th><th>需求人数</th><th>入职数</th><th>达成率</th></tr>
        </thead>
        <tbody>
          <tr v-for="m in data.months" :key="m.month">
            <td>{{ m.month }}</td>
            <td class="num">{{ m.demandCount }}</td>
            <td class="num">{{ m.headcount }}</td>
            <td class="num">{{ m.onboarded }}</td>
            <td class="num" :class="{ 'rate-high': m.achievementRate >= 80, 'rate-low': m.achievementRate < 50 }">{{ m.achievementRate }}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.dvoc { margin-bottom: var(--spacing-lg); }
.chart-card { padding: var(--spacing-lg); min-height: 360px; margin-bottom: var(--spacing-md); }
.chart-card canvas { width: 100% !important; }
.dvoc-table-wrap { max-height: 300px; overflow-y: auto; }
.dvoc-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.dvoc-table th { text-align: left; padding: 8px 12px; background: var(--gray-25); color: var(--gray-500); font-weight: 500; font-size: var(--font-size-xs); position: sticky; top: 0; }
.dvoc-table td { padding: 8px 12px; color: var(--gray-600); border-top: 1px solid var(--gray-100); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.rate-high { color: var(--success); font-weight: 600; }
.rate-low { color: var(--danger); font-weight: 600; }
</style>
