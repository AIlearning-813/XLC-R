/* 新励成招聘管理系统 V2.0 — 错误信息中文化映射 */

/**
 * 将 CloudBase/系统错误信息映射为中文。
 * 用于所有 alert() / toast.error() / error.value 赋值前对 err.message 做转换。
 */
export function toChineseError(err) {
  const raw = (err?.message || err?.code || String(err || '')).toLowerCase();

  // CloudBase 常见错误（具体匹配在前，通用匹配在后）
  if (raw.includes('permission denied') || raw.includes('unauthorized')) return '权限不足，请联系管理员';
  if (raw.includes('network') || raw.includes('timeout') || raw.includes('etimedout')) return '网络连接超时，请检查网络后重试';
  if (raw.includes('storage') && raw.includes('nonexist')) return '文件不存在，可能已被删除';
  if (raw.includes('not found') || raw.includes('nonexist')) return '数据不存在，可能已被删除';
  if (raw.includes('rate limit') || raw.includes('too many')) return '操作过于频繁，请稍后再试';
  if (raw.includes('invalid') || raw.includes('malformed')) return '数据格式错误，请检查输入';
  if (raw.includes('duplicate') || raw.includes('already exists')) return '数据已存在，请勿重复操作';
  if (raw.includes('collection.add:fail')) return '数据写入失败，请稍后重试';
  if (raw.includes('collection.update:fail')) return '数据更新失败，请刷新后重试';
  if (raw.includes('collection.delete:fail')) return '数据删除失败，请稍后重试';
  if (raw.includes('database request fail')) return '数据库请求失败，请稍后重试';
  if (raw.includes('auth') && raw.includes('fail')) return '身份验证失败，请重新登录';

  // 如果消息已经是中文，直接返回
  if (/[一-鿿]/.test(err?.message || '')) return err.message;

  // 兜底中文提示
  return err?.message || err?.code || '操作失败，请稍后重试';
}

/**
 * 安全获取错误消息（优先中文，兜底使用映射）
 */
export function safeErrorMsg(err, fallback = '操作失败，请稍后重试') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  return toChineseError(err) || fallback;
}
