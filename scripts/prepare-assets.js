#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'models');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`❌ Não encontrado: ${src}`);
    return false;
  }
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  const sizeMB = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`✅ Copiado: ${path.basename(dest)} (${sizeMB} MB)`);
  return true;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.log(`❌ Não encontrado: ${src}`);
    return false;
  }
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
  return true;
}

function prepareWhisper() {
  console.log('\n📦 Whisper Large v3');
  const src = path.join(os.homedir(), '.cache', 'whisper', 'large-v3.pt');
  const dest = path.join(ASSETS_DIR, 'whisper', 'large-v3.pt');
  copyFile(src, dest);
}

function prepareGemma(modelId) {
  console.log(`\n📦 Gemma 4 (${modelId})`);
  const cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
  const modelDir = `models--${modelId.replace('/', '--')}`;
  const src = path.join(cacheDir, modelDir);
  const dest = path.join(ASSETS_DIR, 'huggingface', modelDir);
  copyDir(src, dest);
}

function main() {
  console.log('🔧 Preparando assets para build...');
  console.log(`Destino: ${ASSETS_DIR}`);
  
  ensureDir(ASSETS_DIR);
  
  prepareWhisper();
  prepareGemma('google/gemma-4-E2B-it');
  prepareGemma('google/gemma-4-E4B-it');
  prepareGemma('google/gemma-4-12B-it');
  
  console.log('\n✨ Pronto! Rode "npm run build" para gerar o instalador com os modelos.');
}

main();
