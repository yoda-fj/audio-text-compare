#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

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
  // Pula se já existe com mesmo tamanho
  if (fs.existsSync(dest)) {
    const srcStat = fs.statSync(src);
    const destStat = fs.statSync(dest);
    if (srcStat.size === destStat.size) {
      return true;
    }
  }
  fs.copyFileSync(src, dest);
  const sizeMB = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1);
  console.log(`✅ Copiado: ${path.basename(dest)} (${sizeMB} MB)`);
  return true;
}

function copyDirPreserveSymlinks(src, dest) {
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
      copyDirPreserveSymlinks(srcPath, destPath);
    } else if (entry.isSymbolicLink()) {
      if (!fs.existsSync(destPath)) {
        const linkTarget = fs.readlinkSync(srcPath);
        fs.symlinkSync(linkTarget, destPath);
      }
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
  if (copyFile(src, dest)) {
    console.log('   Whisper pronto!');
  } else {
    console.log('   ℹ️  Para incluir Whisper, baixe primeiro:');
    console.log('      python -c "import whisper; whisper.load_model(\'large-v3\')"');
  }
}

function prepareGemma(modelId) {
  console.log(`\n📦 Gemma 4 (${modelId})`);
  const cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
  const modelDir = `models--${modelId.replace('/', '--')}`;
  const src = path.join(cacheDir, modelDir);
  const dest = path.join(ASSETS_DIR, 'huggingface', modelDir);
  if (copyDirPreserveSymlinks(src, dest)) {
    const sizeMB = (getDirSize(dest) / (1024 * 1024)).toFixed(1);
    console.log(`   ✅ Gemma pronto! (${sizeMB} MB)`);
  } else {
    console.log(`   ℹ️  Para incluir ${modelId}, baixe primeiro via app ou:`);
    console.log(`      huggingface-cli download ${modelId}`);
  }
}

function getDirSize(dir) {
  let size = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += getDirSize(fullPath);
    } else if (!entry.isSymbolicLink()) {
      size += fs.statSync(fullPath).size;
    }
  }
  return size;
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
