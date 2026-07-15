/* 新励成招聘管理系统 V2.0 — 简历解析服务 */

import cloudbase from './cloudbase';

// ===== 文本提取 =====

/**
 * 从 File 对象提取文本内容
 * 支持的格式：PDF（PDF.js）、DOCX（Mammoth.js）、TXT/RTF/HTML（直接读取）
 * 图片格式暂不支持浏览器端提取（阶段 3 通过云函数 OCR）
 *
 * 🆕 自动兜底：浏览器端提取失败时，自动切换到服务端提取
 *
 * @param {File} file - 简历文件
 * @returns {Promise<string>} 提取的纯文本
 */
export async function extractText(file) {
  const mime = file.type;
  const name = file.name.toLowerCase();

  try {
    // 尝试浏览器端提取
    return await extractTextBrowser(file);
  } catch (browserErr) {
    console.warn('[resume-parser] 浏览器端文本提取失败，切换到服务端兜底:', browserErr.message);
    // 记录原始错误供调试
    const originalError = browserErr.message || String(browserErr);

    try {
      // 🆕 自动切换到服务端提取
      const text = await extractTextViaServer(file);
      console.log('[resume-parser] ✅ 服务端兜底提取成功:', text.length, '字符');
      return text;
    } catch (serverErr) {
      console.error('[resume-parser] 服务端兜底也失败:', serverErr.message);
      // 抛出包含浏览器端原始错误 + 服务端错误的详细信息
      throw new Error(
        `简历解析失败，请尝试以下方法：\n` +
        `1. 清除浏览器缓存后重试（Chrome: Ctrl+Shift+Del）\n` +
        `2. 将简历文件转换为其他格式（如 Word→PDF 或 PDF→Word）\n` +
        `3. 联系管理员通过邮箱归集方式导入\n` +
        `（错误详情：浏览器端 - ${originalError.slice(0, 100)}；服务端 - ${serverErr.message.slice(0, 100)}）`
      );
    }
  }
}

/**
 * 浏览器端文本提取（原有逻辑）
 */
async function extractTextBrowser(file) {
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

  // 图片格式 → 自动上传到服务端做 OCR
  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|bmp|tiff?|webp)$/i.test(name)) {
    throw new Error('图片格式简历自动切换到服务端OCR文字识别处理，请稍候...');
  }

  // 压缩包 → 服务端递归解压处理
  if (/\.(zip|rar)$/i.test(name) || mime === 'application/zip' || mime === 'application/x-rar-compressed') {
    throw new Error('压缩包格式简历自动切换到服务端解压处理，请稍候...');
  }

  throw new Error(`不支持的文件格式: ${file.name}（${mime || '未知类型'}）`);
}

/**
 * 🆕 服务端文本提取（浏览器端失败时的兜底）
 *
 * 将文件内容以 base64 直接传给 email-scanner 云函数，
 * 使用服务端的 format-router 来提取文本。
 * 服务端 format-router 支持 PDF/DOCX/图片OCR/RTF/HTML/ZIP 等所有格式。
 *
 * @param {File} file - 简历文件
 * @returns {Promise<string>} 提取的纯文本
 */
async function extractTextViaServer(file) {
  // 1. 读取文件内容为 base64
  let fileContent;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    // 分块转 base64（防止大文件栈溢出）
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    fileContent = btoa(binary);
  } catch (readErr) {
    throw new Error(`文件读取失败：${readErr.message}`);
  }

  console.log('[resume-parser] 文件已读取为 base64:', (fileContent.length / 1024).toFixed(1), 'KB');

  // 2. 直接传文件内容给云函数（不经过云存储中转，避免 fileId 兼容问题）
  let extractResult;
  try {
    extractResult = await cloudbase.callFunction('email-scanner', {
      action: 'extractText',
      fileContent,
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
    });
  } catch (callErr) {
    throw new Error(`服务端文本提取调用失败：${callErr.message}`);
  }

  if (!extractResult || !extractResult.success) {
    throw new Error(extractResult?.error || '服务端文本提取返回空结果');
  }

  const text = extractResult.text || '';
  if (text.trim().length < 10) {
    throw new Error('服务端提取的文本内容过短，文件可能为空白或损坏');
  }

  return text;
}

/**
 * 使用 PDF.js 提取 PDF 文本层
 */
async function extractPdfText(file) {
  let pdfjsLib;
  try {
    pdfjsLib = await import('pdfjs-dist');
  } catch (importErr) {
    // 🆕 动态导入失败（常见于浏览器缓存/网络/扩展问题）
    throw new Error(
      `PDF解析库加载失败：浏览器无法加载PDF处理组件。` +
      `这通常是因为浏览器缓存问题或网络限制导致。` +
      `系统将自动切换到服务端处理。` +
      `（技术详情：${importErr.message.slice(0, 80)}）`
    );
  }

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

  // 🆕 文本质量检查：不仅看长度，还看内容有效性
  // 图片型PDF常能提取到元数据（创建者、日期等）超过20字符，
  // 但这些垃圾数据对AI解析毫无价值，需要检测后触发服务端OCR兜底
  const chineseChars = (fullText.match(/[一-鿿]/g) || []).length;
  const alphaChars = (fullText.match(/[a-zA-Z]/g) || []).length;
  const digitChars = (fullText.match(/\d/g) || []).length;
  const hasPhone = /1[3-9]\d{9}/.test(fullText);
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(fullText);

  // 有效简历文本：至少有少量中文字符，或有英文单词+数字（英文简历），或有手机/邮箱
  const hasMeaningfulContent =
    chineseChars >= 10 ||                              // 中文简历至少10个汉字
    (alphaChars >= 30 && digitChars >= 3) ||           // 英文简历至少30个字母+数字
    hasPhone ||                                        // 包含手机号
    hasEmail;                                          // 包含邮箱

  if (!hasMeaningfulContent) {
    console.log(
      `[resume-parser] PDF文本质量不足 (中文:${chineseChars}, 英文:${alphaChars}, 数字:${digitChars}, 手机:${hasPhone}, 邮箱:${hasEmail})，` +
      `切换到服务端OCR处理`
    );
    throw new Error('该文件可能为扫描件（无可提取的文本层），自动切换到服务端OCR处理');
  }

  return fullText;
}

/**
 * 使用 Mammoth.js 提取 DOCX 文本
 */
async function extractDocxText(file) {
  let mammoth;
  try {
    mammoth = await import('mammoth');
  } catch (importErr) {
    // 🆕 动态导入失败
    throw new Error(
      `Word解析库加载失败：浏览器无法加载Word处理组件。` +
      `这通常是因为浏览器缓存问题或网络限制导致。` +
      `系统将自动切换到服务端处理。` +
      `（技术详情：${importErr.message.slice(0, 80)}）`
    );
  }

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
