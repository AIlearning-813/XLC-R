/* 新励成招聘管理系统 V2.0 — 简历解析服务 */

import cloudbase from './cloudbase';

// ===== 文本提取 =====

/**
 * 从 File 对象提取文本内容
 * 支持的格式：PDF（PDF.js）、DOCX（Mammoth.js）、TXT/RTF/HTML（直接读取）
 * 图片格式暂不支持浏览器端提取（阶段 3 通过云函数 OCR）
 *
 * @param {File} file - 简历文件
 * @returns {Promise<string>} 提取的纯文本
 */
export async function extractText(file) {
  const mime = file.type;
  const name = file.name.toLowerCase();

  // PDF → PDF.js
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return extractPdfText(file);
  }

  // DOCX → Mammoth.js
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) {
    return extractDocxText(file);
  }

  // 纯文本 / RTF / HTML → 直接读取
  if (mime === 'text/plain' || mime === 'text/rtf' || mime === 'application/rtf' || mime === 'text/html' ||
      name.endsWith('.txt') || name.endsWith('.rtf') || name.endsWith('.html') || name.endsWith('.htm')) {
    return readTextFile(file);
  }

  // 图片格式 → 需要 OCR（阶段 3 云函数处理，浏览器端暂不支持）
  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|bmp|tiff?|webp)$/i.test(name)) {
    throw new Error('图片格式简历需要通过文字识别处理，浏览器端暂不支持。请使用 PDF/Word/文本 格式，或通过邮箱归集方式处理。');
  }

  // 压缩包 → 阶段 3 云函数递归处理
  if (/\.(zip|rar)$/i.test(name) || mime === 'application/zip' || mime === 'application/x-rar-compressed') {
    throw new Error('压缩包格式简历需要解压处理，浏览器端暂不支持。请解压后上传单文件，或等待阶段 3 邮箱归集功能。');
  }

  throw new Error(`不支持的文件格式: ${file.name}（${mime || '未知类型'}）`);
}

/**
 * 使用 PDF.js 提取 PDF 文本层
 */
async function extractPdfText(file) {
  const pdfjsLib = await import('pdfjs-dist');
  // 设置 Worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(item => item.str).join(' ');
    texts.push(pageText);
  }

  const fullText = texts.join('\n').trim();

  // 如果提取的文本很短（< 20 字符），可能是扫描件
  if (fullText.length < 20) {
    throw new Error('该文件可能为扫描件（无可提取的文本层），浏览器端暂不支持文字识别，请通过邮箱归集方式处理。');
  }

  return fullText;
}

/**
 * 使用 Mammoth.js 提取 DOCX 文本
 */
async function extractDocxText(file) {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value.trim();

  if (!text) {
    throw new Error('Word 文件中未提取到文本内容，文件可能为空或损坏');
  }

  // 记录警告信息（如有）
  if (result.messages.length > 0) {
    console.warn('[resume-parser] Mammoth 提取警告:', result.messages);
  }

  return text;
}

/**
 * 读取纯文本文件（TXT / RTF / HTML）
 */
function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      if (!text || text.trim().length === 0) {
        reject(new Error('文件内容为空'));
      } else {
        resolve(text);
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

// ===== CloudBase 调用 =====

/**
 * 调用 resume-parser-proxy 云函数，通过 DeepSeek API 解析简历文本
 *
 * @param {string} resumeText - 简历纯文本
 * @returns {Promise<{ success: boolean, data?: Object, error?: string, meta?: Object }>}
 */
export async function parseWithDeepSeek(resumeText) {
  if (!resumeText || resumeText.trim().length === 0) {
    return { success: false, error: '简历文本为空' };
  }

  try {
    const result = await cloudbase.callFunction('resume-parser-proxy', {
      resumeText: resumeText.trim(),
    });

    return result;
  } catch (err) {
    console.error('[resume-parser] 云函数调用失败:', err);
    return {
      success: false,
      error: err.message || '解析服务调用失败，请检查网络连接',
    };
  }
}

/**
 * 计算文件的 MD5 哈希（用于文件级去重）
 * @param {File} file
 * @returns {Promise<string>} hex 格式的 MD5 hash
 */
export async function computeFileHash(file) {
  const arrayBuffer = await file.arrayBuffer();
  // 使用 Web Crypto API 计算 SHA-256（浏览器端 MD5 不可用，SHA-256 更安全）
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
