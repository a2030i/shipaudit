import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite has one global warning threshold, while MapLibre is a deliberately
// route-only vendor bundle that cannot be split internally. Keep the build
// output quiet for that documented exception, then enforce tighter budgets
// ourselves for every other JavaScript chunk so regressions still fail CI.
function bundleSizeBudgets() {
  const DEFAULT_MAX = 500_000
  const EXCEPTIONS = [
    { prefix: 'maplibre-', max: 980_000 },
    { prefix: 'xlsx-', max: 520_000 },
  ]

  return {
    name: 'shipaudit-bundle-size-budgets',
    generateBundle(_options, bundle) {
      const violations = []
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue
        const exception = EXCEPTIONS.find(({ prefix }) => fileName.startsWith(`assets/${prefix}`))
        const max = exception?.max || DEFAULT_MAX
        const bytes = Buffer.byteLength(output.code, 'utf8')
        if (bytes > max) violations.push(`${fileName}: ${bytes} bytes (budget ${max})`)
      }
      if (violations.length) {
        this.error(`Bundle size budget exceeded:\n${violations.join('\n')}`)
      }
    },
  }
}

// تقسيم الحزمة (2026-07-21، وسِّع 2026-07-28): كانت 2.8MB في chunk واحد على
// نظام «جوال أولاً» — كل تعديل يُبطل كاش الحزمة كلها. نعزل المكتبات الثقيلة
// في chunks مستقلة، **وكل الصفحات تُحمَّل كسولاً** (React.lazy في App.jsx).
export default defineConfig({
  plugins: [react(), bundleSizeBudgets()],
  // The app uses history routes (for example /employees and /settings/ai).
  // Root-relative assets keep direct loads and browser refreshes from trying
  // to fetch /employees/assets/* or /settings/assets/*.
  base: '/',
  build: {
    // MapLibre is isolated below and loaded only by the short-address map.
    // Per-chunk budgets above remain stricter for all operational pages.
    chunkSizeWarningLimit: 1000,
    // ⚠️ بلا هذا الفلتر يضع Vite وسوم `modulepreload` لكل chunk معرَّف في
    // manualChunks — فكانت مكتبة الإكسل (~420KB) تُنزَّل مع **شاشة الدخول**
    // رغم أنها لا تُستعمل إلا عند رفع/تصدير ملف (بلاغ البطء 2026-07-28).
    // إبقاء الـchunk مشتركاً يمنع تكراره في كل صفحة؛ ومنع الـpreload يجعله
    // يُحمَّل عند أول استعمال حقيقي فقط.
    modulePreload: {
      resolveDependencies: (_url, deps) =>
        deps.filter(d => !/(^|\/)(xlsx|pdfjs|exports)-/.test(d)),
    },
    rollupOptions: {
      output: {
        // دالة لا كائن: خدمات التصدير مشتركة بين عدة صفحات كسولة، فكان
        // rollup يرفعها إلى الحزمة الأولى (لتفادي التكرار) **ومعها xlsx** —
        // فتُنزَّل المكتبة مع شاشة الدخول. عزلها في chunk واحد يبقيها
        // مشتركة بلا تكرار، ويُحمَّل عند أول تصدير/رفع فعلي.
        manualChunks(id) {
          const p = id.replace(/\\/g, '/');
          if (p.includes('node_modules')) {
            if (p.includes('/maplibre-gl/')) return 'maplibre';
            if (p.includes('/xlsx')) return 'xlsx';
            if (p.includes('/pdfjs-dist')) return 'pdfjs';
            if (p.includes('/@supabase')) return 'supabase';
            return undefined;
          }
          // النواة المشتركة (عميل Supabase + عناصر الواجهة + الصلاحيات) تُستعمل
          // من كل صفحة. بلا تخصيصها هنا يبتلعها rollup داخل حزمة `exports`
          // فيضطر ملف الدخول لاستيرادها — **ومعها مكتبة الإكسل**.
          if (/\/(lib\/(supabase|permissions|auth|activityLogger|pageTitles|coreService|periodsService|format)|components\/(UI|BrandLogo))\.jsx?$/.test(p)) {
            return 'core';
          }
          // خدمات التصدير مشتركة بين عدة صفحات كسولة — بلا هذا التجميع يرفعها
          // rollup إلى حزمة الدخول (تفادياً للتكرار) ومعها مكتبة الإكسل.
          if (/\/(lib|engine)\/(internalExportsService|weightBillingService|soaExport|carrierSoaExport|bankReconReport|uploadsHubService|fulfillmentService|ivrService|zohoReportsService|export|bankStatementProcessor)\.js$/.test(p)) {
            return 'exports';
          }
          return undefined;
        },
      },
    },
  },
})
