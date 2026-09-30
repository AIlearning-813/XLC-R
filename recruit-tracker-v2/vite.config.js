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
    // 代码分割（2026-09-30 修复）
    //
    // 原实现用 id.includes('vue') 判定 Vue 生态，但应用自身的 .vue 文件
    // 路径同样包含 'vue'，导致全部页面与组件被强行并入 vue-vendor 分块，
    // router 里 16 条 () => import() 路由懒加载完全失效：产物只有
    // index(4KB) + vue-vendor(1.56MB) + cloudbase，无任何按路由的 chunk。
    //
    // 现在只干预 node_modules 中的第三方库，应用代码交回默认分包，
    // 使路由懒加载恢复正常。
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@cloudbase')) return 'cloudbase';
          if (/node_modules[\\/]@vue[\\/]/.test(id) ||
              /node_modules[\\/](vue|vue-router|pinia)[\\/]/.test(id)) {
            return 'vue-vendor';
          }
          return undefined;
        },
      },
    },
    // 调整 chunk 大小警告阈值
    chunkSizeWarningLimit: 700,
  },
})