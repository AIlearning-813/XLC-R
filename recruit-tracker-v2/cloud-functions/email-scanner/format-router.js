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

  // 🆕 内容质量判断：不只是看长度，而是检查是否包含真实简历内容
  const chineseCount = (fullText.match(/[一-鿿]/g) || []).length;
  const alphaCount = (fullText.match(/[a-zA-Z]/g) || []).length;
  const digitCount = (fullText.match(/\d/g) || []).length;
  const hasPhone = /1[3-9]\d{9}/.test(fullText);
  const hasEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(fullText);

  // 检测重复模式（图片型PDF常提取出重复的hash/ID串）
  const lines = fullText.split('\n').filter(l => l.trim().length > 0);
  let uniqueLineRatio = 1.0;
  if (lines.length >= 3) {
    const uniqueLines = new Set(lines.map(l => l.trim()));
    uniqueLineRatio = uniqueLines.size / lines.length;
  }

  // 有效简历文本判断：
  // 1. 中文≥20字 → 正常中文简历
  // 2. 英文≥50且有数字，且非高度重复 → 正常英文简历
  // 3. 含手机/邮箱 → 简历
  const looksLikeResume =
    chineseCount >= 20 ||
    (alphaCount >= 50 && digitCount >= 2 && uniqueLineRatio >= 0.5) ||
    hasPhone ||
    hasEmail;

  // 图片型PDF的典型特征：
  // - 无中文且文本少 → 纯图片
  // - 高度重复的hash/ID串 → 垃圾文本
  // - 无手机/邮箱等简历特征
  const looksLikeGarbage =
    (chineseCount < 5 && fullText.length < 300) ||
    (uniqueLineRatio < 0.5 && chineseCount < 10) ||
    (!hasPhone && !hasEmail && chineseCount < 5 && alphaCount < 100);

  if (looksLikeGarbage || (!looksLikeResume && fullText.length < 500)) {
    console.log(
      `[format-router] 疑似图片型PDF (总长:${fullText.length}, 中文:${chineseCount}, ` +
      `英文:${alphaCount}, 去重行比:${uniqueLineRatio.toFixed(2)}, 手机:${hasPhone}, 邮箱:${hasEmail})，尝试 OCR...`
    );

    // 尝试 OCR
    let ocrFailed = false;
    let ocrErrorMsg = '';
    try {
      const ocrText = await callTencentOCR(buffer);
      if (ocrText && ocrText.trim().length > 0) {
        const ocrChinese = (ocrText.match(/[一-鿿]/g) || []).length;
        if (ocrChinese >= 5 || ocrText.trim().length > fullText.length * 2) {
          console.log(`[format-router] ✅ OCR 提取成功: ${ocrText.length} 字符, 中文:${ocrChinese}`);
          return ocrText.trim();
        }
        console.log(`[format-router] OCR 质量不佳 (中文:${ocrChinese}, 总长:${ocrText.length})`);
        ocrFailed = true;
        ocrErrorMsg = 'OCR 识别结果质量不足，可能图片不清晰';
      } else {
        ocrFailed = true;
        ocrErrorMsg = 'OCR 返回空结果';
      }
    } catch (ocrErr) {
      ocrFailed = true;
      ocrErrorMsg = ocrErr.message || 'OCR 服务异常';
      console.warn(`[format-router] OCR 尝试失败: ${ocrErrorMsg}`);
    }

    // OCR 失败时抛出明确错误，不要返回垃圾文本给 DeepSeek
    if (ocrFailed) {
      throw new Error(
        `该PDF为图片型/扫描件，无法直接提取文本，且OCR文字识别失败：${ocrErrorMsg}。` +
        `建议：1) 将PDF转换为Word格式后重新上传；2) 确保腾讯云OCR服务已开通且密钥已配置`
      );
    }
  }

  if (fullText.length < 20) {
    throw new Error('PDF 无可提取文本，且 OCR 也未获取到有效内容。该文件可能为多页扫描件或图片质量过低，建议转换为 Word 格式或使用清晰扫描件。');
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

  // 🆕 文本规范化：去噪 + 规范化空白，提升 DeepSeek 解析准确率
  text = normalizeResumeText(text);

  return { text: text.trim(), format };
}

/**
 * 文本预处理：规范化简历文本，去除常见噪音
 *
 * PDF 提取和 OCR 识别经常产生乱码字符、多余空白、编码残留，
 * 规范化后能显著提升 DeepSeek 的解析准确率。
 *
 * @param {string} text - 原始提取文本
 * @returns {string} 规范化后的文本
 */
function normalizeResumeText(text) {
  if (!text) return text;

  let cleaned = text;

  // 1. 合并 3 个以上连续空行为 2 个空行
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // 2. 规范化全角空格为半角空格
  cleaned = cleaned.replace(/　/g, ' ');

  // 3. 去掉每行开头的乱码/控制字符（常见于 PDF 提取），但保留中文和常见符号
  cleaned = cleaned.replace(/^[^一-鿿　-〿＀-￯ -~\t]{1,5}/gm, '');

  // 4. 去掉行首行尾多余空白
  cleaned = cleaned.split('\n').map(line => line.trim()).join('\n');

  // 5. 替换常见 PDF 提取乱码字符
  cleaned = cleaned.replace(/[ --]/g, '');  // 控制字符
  cleaned = cleaned.replace(/[�]/g, '');  // Unicode 替换字符（损坏字符）

  return cleaned;
}

module.exports = { route, MIME_TO_FORMAT, EXT_TO_FORMAT };
