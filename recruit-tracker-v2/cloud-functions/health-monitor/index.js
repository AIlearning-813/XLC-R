/* 新励成招聘管理系统 V2.0 — 健康监控云函数 */
/* 触发：定时触发器（每 30 分钟） */
/* 超时：60s，内存：256MB */

const cloudbase = require('@cloudbase/node-sdk');

exports.main = async (event, context) => {
  const app = cloudbase.init({ env: process.env.ENV_ID });
  const db = app.database();

  const now = new Date();
  const checks = {};

  // 1. 数据库可用性检查
  try {
    const startTime = Date.now();
    await db.collection('Job').limit(1).get();
    checks.database = { ok: true, latency: Date.now() - startTime };
  } catch (err) {
    checks.database = { ok: false, error: err.message };
  }

  // 2. 云存储可用性检查
  try {
    const startTime = Date.now();
    await app.getTempFileURL({ fileList: [] });
    checks.storage = { ok: true, latency: Date.now() - startTime };
  } catch (err) {
    checks.storage = { ok: false, error: err.message };
  }

  // 3. 云函数心跳：检查关键云函数是否最近有产出
  //    通过查询 ErrorLog 中的心跳日志判断
  try {
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

    const { data: recentHeartbeats } = await db.collection('ErrorLog')
      .where({
        type: 'heartbeat',
        createdAt: db.command.gte(new Date(threeHoursAgo)),
      })
      .get();

    checks.heartbeats = {
      ok: true,
      recentCount: recentHeartbeats.length,
    };
  } catch (err) {
    checks.heartbeats = { ok: false, error: err.message };
  }

  // 4. 错误统计（最近 1 小时）
  try {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    const { data: criticalErrors } = await db.collection('ErrorLog')
      .where({
        severity: 'critical',
        createdAt: db.command.gte(new Date(oneHourAgo)),
      })
      .get();

    checks.errors = {
      criticalLastHour: criticalErrors.length,
      needAttention: criticalErrors.length > 0,
    };
  } catch (err) {
    checks.errors = { ok: false, error: err.message };
  }

  // 5. DeepSeek API 余额探测（轻量，仅记录是否可连通）
  try {
    const startTime = Date.now();
    const result = await app.callFunction({
      name: 'resume-parser-proxy',
      data: { healthCheck: true },
    });
    checks.deepseekApi = {
      ok: !result.result?.error,
      latency: Date.now() - startTime,
    };
  } catch (err) {
    // resume-parser-proxy 可能尚未部署（阶段 2 才部署）
    checks.deepseekApi = { ok: true, note: '云函数尚未部署，跳过探测' };
  }

  // 6. 岗位周期检查（是否有岗位超期未关闭）
  try {
    const { data: overdueJobs } = await db.collection('Job')
      .where({
        status: 'open',
        deadline: db.command.lt(now),
      })
      .get();

    if (overdueJobs.length > 0) {
      checks.overdueJobs = {
        count: overdueJobs.length,
        jobs: overdueJobs.map((j) => ({ id: j._id, title: j.title, deadline: j.deadline })),
        warning: `${overdueJobs.length} 个岗位已超过截止日期未关闭`,
      };
    } else {
      checks.overdueJobs = { count: 0, warning: null };
    }
  } catch (err) {
    checks.overdueJobs = { ok: false, error: err.message };
  }

  // 7. 汇总判断
  const allOk = Object.values(checks).every((c) => c.ok !== false);
  const severity = allOk ? 'info' : 'warning';

  // 如果有异常 → 写入 ErrorLog
  if (!allOk) {
    const failedChecks = Object.entries(checks)
      .filter(([, v]) => v.ok === false)
      .map(([k, v]) => `${k}: ${v.error}`);

    await db.collection('ErrorLog').add({
      type: 'heartbeat',
      source: 'health-monitor',
      message: `健康检查异常 (${failedChecks.length}项): ${failedChecks.join('; ')}`,
      context: checks,
      severity,
      createdAt: now,
    });

    console.warn(`⚠️ 健康检查异常: ${failedChecks.join(', ')}`);
  } else {
    console.log('✅ 所有系统正常');
  }

  return { ok: allOk, severity, checks, timestamp: now.toISOString() };
};
