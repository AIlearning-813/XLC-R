import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],

  // P1-8：添加 @ 路径别名，映射到 src/
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    // 代码分割：CloudBase SDK 和 Vue 生态独立分包，避免主包过大
    rollupOptions: {
      output: {
        manualChunks(id) {
          // CloudBase SDK 独立分包
          if (id.includes('@cloudbase/js-sdk') || id.includes('@cloudbase')) {
            return 'cloudbase';
          }
          // Vue 生态独立分包
          if (id.includes('vue') || id.includes('pinia') || id.includes('vue-router')) {
            return 'vue-vendor';
          }
        },
      },
    },
    // 调整 chunk 大小警告阈值（CloudBase SDK 本身约 600KB）
    chunkSizeWarningLimit: 700,
  },
})
