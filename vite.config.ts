import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'
import fs from 'fs'
import path from 'path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

function copyPythonFiles() {
  return {
    name: 'copy-python-files',
    closeBundle() {
      const srcDir = path.resolve(__dirname, 'src/main/python')
      const destDir = path.resolve(__dirname, 'dist/main/python')
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(destDir, { recursive: true })
        for (const file of fs.readdirSync(srcDir)) {
          if (file === '__pycache__') continue
          const srcPath = path.join(srcDir, file)
          if (fs.statSync(srcPath).isFile()) {
            fs.copyFileSync(srcPath, path.join(destDir, file))
          }
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: resolve(__dirname, 'src/main/index.ts'),
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: resolve(__dirname, 'dist/main'),
            rollupOptions: {
              external: ['better-sqlite3', 'pdf-parse', 'pdfjs-dist'],
            },
          },
        },
      },
      preload: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: resolve(__dirname, 'dist/preload'),
          },
        },
      },
      renderer: {},
    }),
    renderer(),
    copyPythonFiles(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
  root: resolve(__dirname, 'src/renderer'),
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
})
