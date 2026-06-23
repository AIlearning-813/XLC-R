/**
 * format-router.test.js — 简历文件格式路由测试
 *
 * 验证 MIME/扩展名映射表 + route 路由输入校验
 */

import { describe, it, expect } from 'vitest';
import { route, MIME_TO_FORMAT, EXT_TO_FORMAT } from './format-router';

describe('format-router — MIME_TO_FORMAT', () => {
  const cases = [
    ['application/pdf', 'pdf'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['application/msword', 'doc'],
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/bmp', 'bmp'],
    ['image/tiff', 'tiff'],
    ['image/webp', 'webp'],
    ['text/plain', 'txt'],
    ['application/rtf', 'rtf'],
    ['text/rtf', 'rtf'],
    ['text/html', 'html'],
    ['application/zip', 'zip'],
    ['application/x-rar-compressed', 'rar'],
    ['application/x-iwork-pages-sffpages', 'pages'],
  ];
  test.each(cases)('%s → %s', (mime, fmt) => {
    expect(MIME_TO_FORMAT[mime]).toBe(fmt);
  });
});

describe('format-router — EXT_TO_FORMAT', () => {
  const cases = [
    ['.pdf', 'pdf'],
    ['.docx', 'docx'],
    ['.doc', 'doc'],
    ['.png', 'png'],
    ['.jpg', 'jpg'],
    ['.jpeg', 'jpg'],
    ['.bmp', 'bmp'],
    ['.tiff', 'tiff'],
    ['.tif', 'tiff'],
    ['.webp', 'webp'],
    ['.txt', 'txt'],
    ['.rtf', 'rtf'],
    ['.html', 'html'],
    ['.htm', 'html'],
    ['.zip', 'zip'],
    ['.rar', 'rar'],
    ['.pages', 'pages'],
  ];
  test.each(cases)('%s → %s', (ext, fmt) => {
    expect(EXT_TO_FORMAT[ext]).toBe(fmt);
  });
});

describe('format-router — route 输入校验', () => {
  it('空 Buffer → 抛出错误', async () => {
    await expect(route(Buffer.alloc(0), 'test.pdf', 'application/pdf'))
      .rejects.toThrow('文件内容为空');
  });

  it('完全未知且非文本格式 → 抛出错误', async () => {
    // 纯二进制数据（非文本、非已知魔数），无法被 detectFormatByContent 回退识别
    const binary = Buffer.alloc(512, 0xFF);
    await expect(
      route(binary, 'file.xyz', 'application/x-unknown')
    ).rejects.toThrow('不支持的文件格式');
  });

  it('未知 MIME 但内容可当文本 → 回退为 txt', async () => {
    // detectFormatByContent 回退逻辑：纯 ASCII 文本 → 识别为 txt
    const result = await route(Buffer.from('hello world'), 'file.xyz', 'application/x-unknown');
    expect(result.format).toBe('txt');
    expect(result.text).toBe('hello world');
  });

  it('DOC 格式提示转换', async () => {
    await expect(
      route(Buffer.from('test'), 'resume.doc', 'application/msword')
    ).rejects.toThrow('DOC 格式暂不支持');
  });

  it('RAR 格式提示解压', async () => {
    await expect(
      route(Buffer.from('test'), 'resume.rar', 'application/x-rar-compressed')
    ).rejects.toThrow('RAR 格式暂不支持');
  });
});
