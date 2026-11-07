import { Plugin, defineConfig } from 'vite';

/**
 * Tashqi CSS fayli birinchi chizilishni to'sib turadi va yuklanish ekranini kechiktiradi,
 * shuning uchun stillar index.html ichiga qo'yiladi. Hajmi kichik: siqilganda taxminan 5 KB.
 */
function inlineCss(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        let result = html;
        for (const file of Object.values(ctx.bundle ?? {})) {
          if (file.type !== 'asset' || !file.fileName.endsWith('.css')) continue;
          const link = new RegExp(`<link[^>]*href="[^"]*${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
          result = result.replace(link, () => `<style>${String(file.source)}</style>`);
          delete ctx.bundle![file.fileName];
        }
        return result;
      },
    },
  };
}

export default defineConfig({
  plugins: [inlineCss()],
  // Kod React uchun yozilgan, lekin ishlashda ancha yengil Preact ishlatiladi: telefon kamroq yuklaydi.
  resolve: {
    alias: {
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react/jsx-dev-runtime': 'preact/jsx-dev-runtime',
      'react-dom/client': 'preact/compat/client',
      'react-dom': 'preact/compat',
      react: 'preact/compat',
    },
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  server: {
    port: Number(process.env.DEV_WEB_PORT ?? 5180),
    allowedHosts: true,
    proxy: { '/api': process.env.DEV_API_TARGET ?? 'http://localhost:4020' },
  },
});
