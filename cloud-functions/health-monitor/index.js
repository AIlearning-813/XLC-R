/**
 * 新励成招聘管理系统 V2.0 — 健康监控云函数
 *
 * 触发方式：定时触发器（每 30 分钟）
 * 功能：心跳检查 + DeepSeek API 余额探测 + 错误统计 + 扫描延迟 + 岗位周期告警
 */

const cloudbase = require('@cloudbase/node-sdk');

// CloudBase 初始化（云函数环境自动注入）
const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
});
const db = app.database();

// 环境变量
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

// 告警阈值
const ERROR_COUNT_THRESHOLD = 10;       // 1小时内 critical+warning > 10 → 告警
const SCAN_STALL_MINUTES = 30;          // 扫描停滞 > 30分钟 → 告警
const SCAN_STALL_CRITICAL_HOURS = 24;   // 扫描停滞 > 24小时 → 严重
const JOB_NO_HIRE_WARN_DAYS = 60;       // 岗位无入职 > 60天 → 警告
const JOB_NO_HIRE_CRITICAL_DAYS = 90;   // 岗位无入职 > 90天 → 严重
const OFFER_STALL_DAYS = 15;            // Offer 阶段停留 > 15天 → 警告
const FIRST_INTERVIEW_BACKLOG = 20;     // 初试积压 > 20人 → 警告

/**
 * 检查云函数心跳
 * 通过数据库读写验证 CloudBase 连接正常
 */
async function checkHeartbeat() {
  try {
    const dbCheck = await db.collection('ErrorLog').count();
    return { healthy: true, dbAccessible: true };
  } catch (err) {
    return { healthy: false, dbAccessible: false, error: err.message };
  }
}

/**
 * 探测 DeepSeek API 余额
 * 发送 1 token 最小请求验证 Key 有效 + 获取余额
 */
async function checkDeepSeekAPI() {
  if (!DEEPSEEK_API_KEY) {
    return { healthy: false, error: 'DEEPSEEK_API_KEY 环境变量未配置' };
  }

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 402) {
      return { healthy: false, error: 'DeepSeek API 余额不足（402 Payment Required）' };
    }
    if (!response.ok) {
      return { healthy: false, error: `DeepSeek API 响应异常: HTTP ${response.status}` };
    }

    return { healthy: true };
  } catch (err) {
    return { healthy: false, error: `DeepSeek API 连接失败: ${err.message}` };
  }
}

/**
 * 统计最近 1 小时的错误数量
 */
async function checkErrorStats() {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const criticalCount = await db.collection('ErrorLog')
      .where({
        severity: 'critical',
        createdAt: db.command.gte(oneHourAgo),
      })
      .count();

    const warningCount = await db.collection('ErrorLog')
      .where({
        severity: 'warning',
        createdAt: db.command.gte(oneHourAgo),
      })
      .count();

    const total = (criticalCount.total || 0) + (warningCount.total || 0);
    return {
      total,
      critical: criticalCount.total || 0,
      warning: warningCount.total || 0,
      alert: total > ERROR_COUNT_THRESHOLD,
    };
  } catch (err) {
    console.error('[健康监控] 错误统计查询失败:', err.message);
    return { total: 0, critical: 0, warning: 0, alert: false, error: err.message };
  }
}

/**
 * 检查邮件扫描延迟
 */
async function checkScanDelay() {
  try {
    const configs = await db.collection('EmailConfig')
      .where({ enabled: true })
      .get();

    const stalledConfigs = [];
    const now = Date.now();

    for (const config of configs.data) {
      if (!config.lastSuccessfulScanAt) continue;

      const lastScan = new Date(config.lastSuccessfulScanAt).getTime();
      const delayMinutes = Math.floor((now - lastScan) / (60 * 1000));

      if (delayMinutes > SCAN_STALL_MINUTES) {
        stalledConfigs.push({
          email: config.email,
          lastSuccessfulScanAt: config.lastSuccessfulScanAt,
          delayMinutes,
          severity: delayMinutes > SCAN_STALL_CRITICAL_HOURS * 60 ? 'critical' : 'warning',
        });
      }
    }

    return {
      totalEnabled: configs.data.length,
      stalled: stalledConfigs.length,
      details: stalledConfigs,
      alert: stalledConfigs.length > 0,
    };
  } catch (err) {
    console.error('[健康监控] 扫描延迟检查失败:', err.message);
    return { totalEnabled: 0, stalled: 0, details: [], alert: false, error: err.message };
  }
}

/**
 * 检查岗位周期告警
 */
async function checkJobCycle() {
  try {
    const activeJobs = await db.collection('Job')
      .where({ status: 'active' })
      .get();

    const alerts = [];
    const now = Date.now();

    for (const job of activeJobs.data) {
      const createdAt = new Date(job.createdAt).getTime();
      const activeDays = Math.floor((now - createdAt) / (24 * 60 * 60 * 1000));

      // 检查岗位无入职天数
      if (activeDays > JOB_NO_HIRE_WARN_DAYS) {
        alerts.push({
          type: 'job_no_hire',
          jobId: job._id,
          title: job.title,
          activeDays,
          severity: activeDays > JOB_NO_HIRE_CRITICAL_DAYS ? 'critical' : 'warning',
          message: `岗位"${job.title}"挂出 ${activeDays} 天无入职`,
        });
      }
    }

    // 检查 Offer 阶段候选人和初试积压
    const offerStalled = await db.collection('Application')
      .where({
        stage: 'offer',
        status: 'active',
      })
      .count();

    if (offerStalled.total > 0) {
      // 检查具体停留天数（简化处理，只计数）
      alerts.push({
        type: 'offer_stall',
        count: offerStalled.total,
        severity: 'warning',
        message: `${offerStalled.total} 位候选人停留在 Offer 阶段`,
      });
    }

    const firstInterviewBacklog = await db.collection('Application')
      .where({
        stage: 'first_interview',
        status: 'active',
      })
      .count();

    if (firstInterviewBacklog.total > FIRST_INTERVIEW_BACKLOG) {
      alerts.push({
        type: 'interview_backlog',
        count: firstInterviewBacklog.total,
        severity: 'warning',
        message: `初试阶段积压 ${firstInterviewBacklog.total} 人（阈值: ${FIRST_INTERVIEW_BACKLOG}）`,
      });
    }

    return {
      totalActiveJobs: activeJobs.data.length,
      alerts,
      alert: alerts.length > 0,
    };
  } catch (err) {
    console.error('[健康监控] 岗位周期检查失败:', err.message);
    return { totalActiveJobs: 0, alerts: [], alert: false, error: err.message };
  }
}

/**
 * 写入心跳日志
 */
async function writeHeartbeatLog(result) {
  try {
    await db.collection('HeartbeatLog').add({
      timestamp: new Date(),
      overall: result.overall,
      details: result.details,
    });
  } catch (err) {
    console.error('[健康监控] 心跳日志写入失败:', err.message);
  }
}

/**
 * 写入 ErrorLog 告警
 */
async function writeAlerts(alerts) {
  if (alerts.length === 0) return;

  try {
    for (const alert of alerts) {
      await db.collection('ErrorLog').add({
        type: 'heartbeat',
        source: 'health-monitor',
        message: alert.message,
        context: alert,
        severity: alert.severity || 'warning',
        createdAt: new Date(),
      });
    }
  } catch (err) {
    console.error('[健康监控] 告警写入失败:', err.message);
  }
}

/**
 * 主入口
 */
exports.main = async (event, context) => {
  const startTime = Date.now();
  console.log('[health-monitor] 开始健康检查...');

  // 1. 心跳检查
  const heartbeat = await checkHeartbeat();

  // 2. DeepSeek API 探测
  const deepseek = await checkDeepSeekAPI();

  // 3. 错误统计
  const errorStats = await checkErrorStats();

  // 4. 扫描延迟
  const scanDelay = await checkScanDelay();

  // 5. 岗位周期
  const jobCycle = await checkJobCycle();

  // 汇总所有异常
  const allAlerts = [];

  if (!heartbeat.healthy) {
    allAlerts.push({
      message: 'CloudBase 数据库连接异常',
      context: heartbeat,
      severity: 'critical',
    });
  }

  if (!deepseek.healthy) {
    allAlerts.push({
      message: `DeepSeek API 异常: ${deepseek.error}`,
      context: deepseek,
      severity: deepseek.error?.includes('余额') ? 'critical' : 'warning',
    });
  }

  if (errorStats.alert) {
    allAlerts.push({
      message: `最近 1 小时错误数异常: ${errorStats.total} 条（critical: ${errorStats.critical}, warning: ${errorStats.warning}）`,
      context: errorStats,
      severity: errorStats.critical > 0 ? 'critical' : 'warning',
    });
  }

  if (scanDelay.alert) {
    for (const detail of scanDelay.details) {
      allAlerts.push({
        message: `邮箱 ${detail.email} 扫描停滞 ${detail.delayMinutes} 分钟`,
        context: detail,
        severity: detail.severity || 'warning',
      });
    }
  }

  if (jobCycle.alert) {
    for (const alert of jobCycle.alerts) {
      allAlerts.push(alert);
    }
  }

  // 确定总体状态
  const hasCritical = allAlerts.some(a => a.severity === 'critical');
  const overall = hasCritical ? 'critical' : (allAlerts.length > 0 ? 'warning' : 'healthy');

  const result = {
    overall,
    duration: Date.now() - startTime,
    details: {
      heartbeat,
      deepseek,
      errorStats,
      scanDelay,
      jobCycle,
    },
  };

  // 持久化
  await writeHeartbeatLog(result);
  await writeAlerts(allAlerts);

  console.log(`[health-monitor] 检查完成: ${overall}, ${allAlerts.length} 条告警, 耗时 ${result.duration}ms`);
  return result;
};
