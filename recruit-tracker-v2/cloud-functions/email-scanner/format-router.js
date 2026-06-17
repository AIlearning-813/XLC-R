/**
 * format-router.js — 简历文件格式识别与文本提取
 *
 * 支持 15 种文件格式，按 MIME 类型 → 扩展名两级匹配，自动分发到对应提取策略。
 * 同时部署于 email-scanner 和 parse-queue-processor 两个云函数中。
 *
 * 格式覆盖：
 *   PDF, DOCX, DOC, PNG, JPG/JPEG, BMP, TIFF, WebP,
 *   TXT, RTF, HTML, ZIP, RAR, Apple Pages
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ===== 懒加载依赖（仅在实际使用时 require）=====

let pdfjsLib = null;
function getPdfJs() {
  if (!pdfjsLib) {
    pdfjsLib = require('pdfjs-dist');
  }
  return pdfjsLib;
}

let mammoth = null;
function getMammoth() {
  if (!mammoth) {
    mammoth = require('mammoth');
  }
  return mammoth;
}

let sharp = null;
function getSharp() {
  if (!sharp) {
    sharp = require('sharp');
  }
  return sharp;
}

let AdmZip = null;
function getAdmZip() {
  if (!AdmZip) {
    AdmZip = require('adm-zip');
  }
  return AdmZip;
}

// ===== MIME 类型 → 格式映射 =====

const MIME_TO_FORMAT = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'text/html': 'html',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/x-iwork-pages-sffpages': 'pages',
};

// 扩展名 → 格式映射（MIME 不可靠时的降级方案）
const EXT_TO_FORMAT = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.doc': 'doc',
  '.png': 'png',
  '.jpg': 'jpg',
  '.jpeg': 'jpg',
  '.bmp': 'bmp',
  '.tiff': 'tiff',
  '.tif': 'tiff',
  '.webp': 'webp',
  '.txt': 'txt',
  '.rtf': 'rtf',
  '.html': 'html',
  '.htm': 'html',
  '.zip': 'zip',
  '.rar': 'rar',
  '.pages': 'pages',
};

// 压缩包内可提取的格式（递归处理）
const ARCHIVE_EXTRACTABLE = new Set([
  'pdf', 'docx', 'doc', 'png', 'jpg', 'bmp', 'tiff', 'webp', 'txt', 'rtf', 'html',
]);

// ===== 编码检测 =====

/**
 * 检测文本 buffer 的编码（UTF-8 / GBK / GB2312）
 * 简单启发式：先尝试 UTF-8 解码，失败则尝试 GBK
 */
function detectAndDecode(buffer) {
  // 检查 BOM
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.subarray(3).toString('utf-8');
  }

  // 先尝试 UTF-8
  try {
    const text = buffer.toString('utf-8');
    // 检查是否有替换字符（�），如果有说明 UTF-8 解码有问题
    if (!text.includes('�')) {
      return text;
    }
  } catch {
    // UTF-8 解码失败
  }

  // 降级到 GBK
  try {
    const iconv = require('iconv-lite');
    return iconv.decode(buffer, 'gbk');
  } catch {
    // 如果 iconv-lite 不可用，返回 UTF-8 结果
    return buffer.toString('utf-8');
  }
}

// ===== 各格式提取策略 =====

/**
 * 提取 PDF 文本
 */
async function extractPdf(buffer) {
  const pdfjs = getPdfJs();
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data, disableAutoFetch: true }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(' ');
    pages.push(pageText);
  }

  const fullText = pages.join('\n').trim();

  // 检测是否为扫描件（文本太少）
  if (fullText.length < 20) {
    throw new Error('PDF 文本量过少，可能是扫描件，请使用 OCR 处理');
  }

  return fullText;
}

/**
 * 提取 DOCX 文本
 */
async function extractDocx(buffer) {
  const mammothInstance = getMammoth();
  const result = await mammothInstance.extractRawText({ buffer });
  return result.value.trim();
}

/**
 * 提取 DOC 文本（使用 word-extractor）
 */
async function extractDoc(buffer) {
  try {
    const WordExtractor = require('word-extractor');
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    return doc.getBody().trim();
  } catch (err) {
    throw new Error(`DOC 文件提取失败：${err.message}`);
  }
}

/**
 * 提取图片文本（通过腾讯云 OCR）
 * @param {Buffer} buffer - 图片 buffer
 * @param {string} format - 图片格式 (png/jpg/bmp/tiff/webp)
 */
async function extractImage(buffer, format) {
  // 预处理：使用 sharp 统一转为 PNG（优化 OCR 识别率）
  let processedBuffer = buffer;
  try {
    const sharpInstance = getSharp();
    processedBuffer = await sharpInstance(buffer)
      .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch (sharpErr) {
    // sharp 处理失败时尝试直接用原图
    console.warn('[format-router] sharp 预处理失败，使用原图:', sharpErr.message);
    processedBuffer = buffer;
  }

  // 调用腾讯云 OCR
  return callTencentOCR(processedBuffer);
}

/**
 * 提取纯文本（自动编码检测）
 */
function extractText(buffer) {
  return detectAndDecode(buffer);
}

/**
 * 提取 RTF 文本
 */
async function extractRtf(buffer) {
  try {
    const rtfParser = require('rtf-parser');
    return new Promise((resolve, reject) => {
      rtfParser.string(buffer, (err, doc) => {
        if (err) return reject(err);
        // 递归提取所有文本段落
        function extractParagraphs(node) {
          if (typeof node === 'string') return node;
          if (Array.isArray(node)) return node.map(extractParagraphs).join('\n');
          if (node && node.content) return extractParagraphs(node.content);
          return '';
        }
        resolve(extractParagraphs(doc).trim());
      });
    });
  } catch (err) {
    throw new Error(`RTF 文件提取失败：${err.message}`);
  }
}

/**
 * 提取 HTML 文本（去除标签）
 */
function extractHtml(buffer) {
  const html = detectAndDecode(buffer);
  // 简单去除 HTML 标签
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, '\n')
    .trim();
}

/**
 * 提取 ZIP 压缩包文本（递归处理）
 */
async function extractZip(buffer) {
  const AdmZipClass = getAdmZip();
  const zip = new AdmZipClass(buffer);
  const entries = zip.getEntries();

  const results = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const entryName = entry.entryName;
    const ext = path.extname(entryName).toLowerCase();
    const format = EXT_TO_FORMAT[ext];

    // 跳过不支持的格式和非简历文件
    if (!format || !ARCHIVE_EXTRACTABLE.has(format)) continue;

    // 跳过明显的系统文件
    if (entryName.startsWith('__MACOSX') || entryName.startsWith('.')) continue;

    try {
      const entryBuffer = entry.getData();
      const result = await route(entryBuffer, entryName, null);
      if (result.text) {
        results.push({ text: result.text, fileName: entryName, format: result.format });
      }
    } catch (err) {
      console.warn(`[format-router] ZIP 内文件 "${entryName}" 提取失败:`, err.message);
    }
  }

  // 合并所有文本
  const combinedText = results
    .map((r) => `--- ${r.fileName} (${r.format}) ---\n${r.text}`)
    .join('\n\n');

  return combinedText || '';
}

/**
 * 提取 RAR 压缩包文本
 */
async function extractRar(buffer) {
  try {
    const unrar = require('node-unrar-js');
    const extractor = await unrar.createExtractorFromData({ data: buffer });
    const extracted = extractor.extractAll();

    if (!extracted || !extracted.files) {
      return '';
    }

    const results = [];
    for (const file of extracted.files) {
      if (file.fileHeader.flags.directory) continue;

      const ext = path.extname(file.fileHeader.name).toLowerCase();
      const format = EXT_TO_FORMAT[ext];
      if (!format || !ARCHIVE_EXTRACTABLE.has(format)) continue;

      try {
        const fileBuffer = Buffer.from(file.extraction);
        const result = await route(fileBuffer, file.fileHeader.name, null);
        if (result.text) {
          results.push({ text: result.text, fileName: file.fileHeader.name, format: result.format });
        }
      } catch (err) {
        console.warn(`[format-router] RAR 内文件 "${file.fileHeader.name}" 提取失败:`, err.message);
      }
    }

    return results.map((r) => `--- ${r.fileName} (${r.format}) ---\n${r.text}`).join('\n\n');
  } catch (err) {
    throw new Error(`RAR 文件提取失败：${err.message}`);
  }
}

/**
 * 提取 Apple Pages 文本（.pages 本质是 ZIP）
 */
async function extractPages(buffer) {
  // .pages 文件是 ZIP 格式，内含 preview.pdf 或 index.xml
  const AdmZipClass = getAdmZip();
  const zip = new AdmZipClass(buffer);

  // 优先尝试提取 preview.pdf
  const previewEntry = zip.getEntry('preview.pdf');
  if (previewEntry) {
    const pdfBuffer = previewEntry.getData();
    return extractPdf(pdfBuffer);
  }

  // 降级：提取 index.xml 中的文本
  const indexEntry = zip.getEntry('index.xml');
  if (indexEntry) {
    const xmlBuffer = indexEntry.getData();
    const xml = xmlBuffer.toString('utf-8');
    // 简单去除 XML 标签提取文本
    return xml.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, '\n').trim();
  }

  throw new Error('Pages 文件中未找到可提取的内容');
}

// ===== 腾讯云 OCR 调用 =====

/**
 * 调用腾讯云通用印刷体 OCR API（TC3-HMAC-SHA256 签名）
 */
async function callTencentOCR(imageBuffer) {
  const secretId = process.env.TENCENT_SECRET_ID || '';
  const secretKey = process.env.TENCENT_SECRET_KEY || '';

  if (!secretId || !secretKey) {
    throw new Error('OCR 服务未配置：请设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY 环境变量');
  }

  // Base64 编码图片（不超过 7MB）
  const imageBase64 = imageBuffer.toString('base64');
  if (imageBase64.length > 7 * 1024 * 1024) {
    throw new Error('图片过大，OCR 限制 7MB');
  }

  const action = 'GeneralBasicOCR';
  const version = '2018-11-19';
  const region = 'ap-guangzhou';
  const service = 'ocr';
  const host = 'ocr.tencentcloudapi.com';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  // 构建请求体
  const payload = JSON.stringify({
    ImageBase64: imageBase64,
    LanguageType: 'zh',
  });

  // TC3-HMAC-SHA256 签名
  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');

  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json; charset=utf-8\nhost:${host}\n`,
    'content-type;host',
    hashedPayload,
  ].join('\n');

  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n');

  // 派生签名密钥
  const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const kService = crypto.createHmac('sha256', kDate).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;

  // 发送请求（使用 Node.js 内置 https 模块）
  const https = require('https');
  const fetch = require('node-fetch');

  const response = await fetch(`https://${host}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Version': version,
      'X-TC-Timestamp': timestamp,
      'X-TC-Region': region,
      Authorization: authorization,
    },
    body: payload,
  });

  if (!response.ok) {
    throw new Error(`OCR API 请求失败：HTTP ${response.status}`);
  }

  const result = await response.json();

  if (result.Response.Error) {
    throw new Error(`OCR 识别失败：${result.Response.Error.Code} - ${result.Response.Error.Message}`);
  }

  // 提取识别文本
  const textDetections = result.Response.TextDetections || [];
  return textDetections.map((item) => item.DetectedText).join('\n');
}

// ===== 主路由函数 =====

/**
 * 识别文件格式并提取文本
 *
 * @param {Buffer} buffer - 文件内容
 * @param {string} fileName - 原始文件名
 * @param {string|null} mimeType - MIME 类型（可选）
 * @returns {Promise<{text: string, format: string}>}
 */
async function route(buffer, fileName, mimeType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('文件内容为空');
  }

  // 第 1 级：MIME 类型匹配
  let format = mimeType ? MIME_TO_FORMAT[mimeType] : null;

  // 第 2 级：扩展名降级匹配
  if (!format && fileName) {
    const ext = path.extname(fileName).toLowerCase();
    format = EXT_TO_FORMAT[ext];
  }

  if (!format) {
    throw new Error(`不支持的文件格式：${fileName || '未知'}（MIME: ${mimeType || '未知'}）`);
  }

  // 分发到对应提取策略
  let text = '';

  switch (format) {
    case 'pdf':
      text = await extractPdf(buffer);
      break;
    case 'docx':
      text = await extractDocx(buffer);
      break;
    case 'doc':
      text = await extractDoc(buffer);
      break;
    case 'png':
    case 'jpg':
    case 'bmp':
    case 'tiff':
    case 'webp':
      text = await extractImage(buffer, format);
      break;
    case 'txt':
      text = extractText(buffer);
      break;
    case 'rtf':
      text = await extractRtf(buffer);
      break;
    case 'html':
      text = extractHtml(buffer);
      break;
    case 'zip':
      text = await extractZip(buffer);
      break;
    case 'rar':
      text = await extractRar(buffer);
      break;
    case 'pages':
      text = await extractPages(buffer);
      break;
    default:
      throw new Error(`格式 "${format}" 暂不支持自动提取`);
  }

  if (!text || text.trim().length === 0) {
    throw new Error(`未能从文件中提取到文本内容（格式：${format}）`);
  }

  return { text: text.trim(), format };
}

module.exports = { route, MIME_TO_FORMAT, EXT_TO_FORMAT };
