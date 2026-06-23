/**
 * Vite E2E 测试配置
 *
 * 将 src/services/cloudbase.js 替换为浏览器端 Mock，
 * 让 Playwright 可以通过 window.__mockDB__ 控制假后端。
 *
 * 使用 load 钩子直接替换模块内容（比 resolveId/alias 更可靠），
 * 确保无论从哪个路径引用 cloudbase 服务都被 Mock。
 */
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_PATH = path.resolve(__dirname, 'e2e/mocks/cloudbase-mock.js');
const REAL_SERVICE = path.resolve(__dirname, 'src/services/cloudbase.js');
const MOCK_CONTENT = fs.readFileSync(MOCK_PATH, 'utf-8');

/**
 * Vite 插件：在 load 阶段将 cloudbase 服务替换为 Mock 内容
 */
function mockCloudbasePlugin() {
  // 标准化路径用于比较
  const realPath = REAL_SERVICE.replace(/\\/g, '/');

  return {
    name: 'mock-cloudbase',
    load(id) {
      // load 钩子收到的是已解析的绝对路径，统一用正斜杠比较
      const normalized = id.replace(/\\/g, '/');

      if (normalized === realPath) {
        console.log('[mock-cloudbase] 替换 cloudbase 服务 → 浏览器 Mock');
        return MOCK_CONTENT;
      }
      return null; // 其他模块正常加载
    },
  };
}

export default defineConfig({
  plugins: [vue(), mockCloudbasePlugin()],
  resolve: {
    alias: {
      // 兜底：通过路径别名确保所有变体都被匹配
      [REAL_SERVICE]: MOCK_PATH,
      [`${REAL_SERVICE.replace(/\.js$/, '')}`]: MOCK_PATH,
    },
  },
  // E2E 测试用固定端口
  server: {
    port: 4173,
    strictPort: true,
  },
  define: {
    'import.meta.env.VITE_MOCK_MODE': JSON.stringify('true'),
  },
});
