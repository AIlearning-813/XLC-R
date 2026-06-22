/**
 * format-router.js — 简历文件格式识别与文本提取
 *
 * 支持的文件格式，按 MIME 类型 → 扩展名两级匹配，自动分发到对应提取策略。
 * 同时部署于 email-scanner 和 parse-queue-processor 两个云函数中。
 *
 * 注意：仅使用纯 JS 依赖（无原生 C++ 模块），确保 CloudBase SCF 兼容。
 *
 * 格式覆盖：
 *   PDF, DOCX, PNG, JPG/JPEG, BMP, TIFF, WebP,
 *   TXT, RTF, HTML, ZIP, Apple Pages
 */

const path = require('path');
const crypto = require('crypto');

// ===== 懒加载依赖（仅在实际使用时 require，纯 JS 库）=====

let pdfParse = null;
function getPdfParse() {
  if (!pdfParse) {
    pdfParse = require('pdf-parse');
  }
  return pdfParse;
}

let mammoth = null;
function getMammoth() {
  if (!mammoth) {
    mammoth = require('mammoth');
  }
  return mammoth;
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

const ARCHIVE_EXTRACTABLE = new Set([
  'pdf', 'docx', 'png', 'jpg', 'bmp', 'tiff', 'webp', 'txt', 'rtf', 'html',
]);

// ===== 文件内容魔数检测（用于无扩展名或 application/octet-stream）=====

function detectFormatByContent(buffer) {
  if (!buffer || buffer.length < 4) return null;

  // ZIP/DOCX: PK\x03\x04
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    // DOCX 本质是 ZIP，BOSS直聘简历通常为 DOCX
    return 'docx';
  }

  // PDF: %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'pdf';
  }

  // PNG: \x89PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'png';
  }

  // JPEG: \xFF\xD8\xFF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpg';
  }

  // BMP: BM
  if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
    return 'bmp';
  }

  // TIFF: II or MM
  if ((buffer[0] === 0x49 && buffer[1] === 0x49) || (buffer[0] === 0x4D && buffer[1] === 0x4D)) {
    return 'tiff';
  }

  // WebP: RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'webp';
  }

  // RTF: {\rtf
  if (buffer[0] === 0x7B && buffer[1] === 0x5C && buffer[2] === 0x72 && buffer[3] === 0x74) {
    return 'rtf';
  }

  // HTML: <htm or <!DO
  const head = buffer.toString('ascii', 0, 10).trim().toLowerCase();
  if (head.startsWith('<htm') || head.startsWith('<!do')) {
    return 'html';
  }

  // 纯文本回退
  try {
    const test = buffer.toString('utf-8', 0, 512);
    if (/^[\x20-\x7E一-鿿　-〿＀-￯\r\n\t]+/.test(test)) {
      return 'txt';
    }
  } catch { /* ignore */ }

  return null;
}

// ===== 编码检测 =====

function detectAndDecode(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.subarray(3).toString('utf-8');
  }
  try {
    const text = buffer.toString('utf-8');
    if (!text.includes('�')) return text;
  } catch { /* fall through */ }

  try {
    const iconv = require('iconv-lite');
    return iconv.decode(buffer, 'gbk');
  } catch {
    return buffer.toString('utf-8');
  }
}

// ===== 各格式提取策略 =====

async function extractPdf(buffer) {
  const pdfParse = getPdfParse();
  const data = await pdfParse(buffer);
  const fullText = (data.text || '').trim();
  if (fullText.length < 20) {
    throw new Error('PDF 文本量过少，可能是扫描件，请使用 OCR 处理');
  }
  return fullText;
}

async function extractDocx(buffer) {
  const mammothInstance = getMammoth();
  const result = await mammothInstance.extractRawText({ buffer });
  return result.value.trim();
}

/**
 * 提取图片文本（通过腾讯云 OCR，不做本地预处理）
 * sharp 是原生 C++ 模块，CloudBase SCF 不兼容，直接传原图给 OCR
 */
async function extractImage(buffer, format) {
  return callTencentOCR(buffer);
}

function extractText(buffer) {
  return detectAndDecode(buffer);
}

/**
 * 提取 RTF 文本（纯 JS rtf-parser）
 */
async function extractRtf(buffer) {
  try {
    const rtfParser = require('rtf-parser');
    return new Promise((resolve, reject) => {
      rtfParser.string(buffer, (err, doc) => {
        if (err) return reject(err);
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

function extractHtml(buffer) {
  const html = detectAndDecode(buffer);
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
    if (!format || !ARCHIVE_EXTRACTABLE.has(format)) continue;
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
  return results.map((r) => `--- ${r.fileName} (${r.format}) ---\n${r.text}`).join('\n\n') || '';
}

async function extractPages(buffer) {
  const AdmZipClass = getAdmZip();
  const zip = new AdmZipClass(buffer);
  const previewEntry = zip.getEntry('preview.pdf');
  if (previewEntry) {
    return extractPdf(previewEntry.getData());
  }
  const indexEntry = zip.getEntry('index.xml');
  if (indexEntry) {
    const xml = indexEntry.getData().toString('utf-8');
    return xml.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, '\n').trim();
  }
  throw new Error('Pages 文件中未找到可提取的内容');
}

// ===== 腾讯云 OCR 调用（TC3-HMAC-SHA256 签名，纯 JS）=====

async function callTencentOCR(imageBuffer) {
  const secretId = process.env.TENCENT_SECRET_ID || '';
  const secretKey = process.env.TENCENT_SECRET_KEY || '';

  if (!secretId || !secretKey) {
    throw new Error('OCR 服务未配置：请设置 TENCENT_SECRET_ID 和 TENCENT_SECRET_KEY 环境变量');
  }

  const imageBase64 = imageBuffer.toString('base64');
  if (imageBase64.length > 7 * 1024 * 1024) {
    throw new Error('图片过大，OCR 限制 7MB');
  }

  const action = 'GeneralBasicOCR';
  const version = '2018-11-19';
  const service = 'ocr';
  const host = 'ocr.tencentcloudapi.com';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const payload = JSON.stringify({ ImageBase64: imageBase64, LanguageType: 'zh' });
  const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');

  const canonicalRequest = [
    'POST', '/', '',
    `content-type:application/json; charset=utf-8\nhost:${host}\n`,
    'content-type;host',
    hashedPayload,
  ].join('\n');

  const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, hashedCanonicalRequest].join('\n');

  const kDate = crypto.createHmac('sha256', `TC3${secretKey}`).update(date).digest();
  const kService = crypto.createHmac('sha256', kDate).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;

  // 使用 Node.js 内置 https 模块发请求（不依赖 node-fetch）
  const https = require('https');
  const response = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Host': host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Timestamp': timestamp,
        'X-TC-Region': 'ap-guangzhou',
        'Authorization': authorization,
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`OCR 响应解析失败: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  if (response.Response.Error) {
    throw new Error(`OCR 识别失败：${response.Response.Error.Code} - ${response.Response.Error.Message}`);
  }

  const textDetections = response.Response.TextDetections || [];
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

  let format = mimeType ? MIME_TO_FORMAT[mimeType] : null;
  if (!format && fileName) {
    const ext = path.extname(fileName).toLowerCase();
    format = EXT_TO_FORMAT[ext];
  }

  if (!format) {
    // application/octet-stream 或无扩展名文件 → 内容检测
    format = detectFormatByContent(buffer);
    console.log(`[format-router] MIME/扩展名无法识别，内容检测结果: ${format} (${fileName}, ${mimeType})`);
  }

  if (!format) {
    throw new Error(`不支持的文件格式：${fileName || '未知'}（MIME: ${mimeType || '未知'}）`);
  }

  // 不支持的原生依赖格式：明确提示
  if (format === 'doc') {
    throw new Error('DOC 格式暂不支持（需原生依赖），请转换为 DOCX 或 PDF 后重试');
  }
  if (format === 'rar') {
    throw new Error('RAR 格式暂不支持（需原生依赖），请解压为 ZIP 后重试');
  }

  let text = '';
  switch (format) {
    case 'pdf': text = await extractPdf(buffer); break;
    case 'docx': text = await extractDocx(buffer); break;
    case 'png': case 'jpg': case 'bmp': case 'tiff': case 'webp':
      text = await extractImage(buffer, format); break;
    case 'txt': text = extractText(buffer); break;
    case 'rtf': text = await extractRtf(buffer); break;
    case 'html': text = extractHtml(buffer); break;
    case 'zip': text = await extractZip(buffer); break;
    case 'pages': text = await extractPages(buffer); break;
    default:
      throw new Error(`格式 "${format}" 暂不支持自动提取`);
  }

  if (!text || text.trim().length === 0) {
    throw new Error(`未能从文件中提取到文本内容（格式：${format}）`);
  }

  return { text: text.trim(), format };
}

module.exports = { route, MIME_TO_FORMAT, EXT_TO_FORMAT };
