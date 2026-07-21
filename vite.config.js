import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// تقسيم الحزمة (2026-07-21): كانت 2.8MB في chunk واحد على نظام «جوال أولاً»
// للتحصيل — كل تعديل يُبطل كاش الحزمة كلها. نعزل المكتبات الثقيلة في chunks
// مستقلة تُحمَّل عند الحاجة (xlsx عند التصدير، pdfjs عند رفع PDF).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          xlsx: ['xlsx'],
          pdfjs: ['pdfjs-dist'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
