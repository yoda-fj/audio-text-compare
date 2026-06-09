import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { DatabaseManager } from './database'
import { FileProcessor } from './fileProcessor'
import { PythonClient } from './pythonClient'

app.setName('audio-text-compare')

let mainWindow: BrowserWindow | null = null
const db = new DatabaseManager()
const fileProcessor = new FileProcessor()
const pythonClient = new PythonClient()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// IPC Handlers
ipcMain.handle('select-file', async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: options.filters,
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('read-document', async (_, filePath: string, options?: { pageStart?: number; pageEnd?: number }) => {
  return fileProcessor.readDocument(filePath, options)
})

ipcMain.handle('transcribe-audio', async (_, filePath: string, model: string) => {
  const hfToken = db.getDecryptedSetting('hf_token')
  if (!hfToken) {
    return { text: '', error: 'Hugging Face Token não configurado. Configure em Configurações.' }
  }
  try {
    const result = await pythonClient.transcribe(filePath, {
      model,
      onProgress: (progress, message) => {
        mainWindow?.webContents.send('transcription-progress', progress, message)
      },
    })
    return result
  } catch (error: any) {
    return { text: '', error: error.message || String(error) }
  }
})

ipcMain.handle('compare-texts', async (_, original: string, transcribed: string) => {
  return fileProcessor.compareTexts(original, transcribed)
})

ipcMain.handle('save-comparison', async (_, data) => {
  return db.saveComparison(data)
})

ipcMain.handle('get-comparisons', async () => {
  return db.getComparisons()
})

ipcMain.handle('get-comparison', async (_, id: number) => {
  return db.getComparison(id)
})

ipcMain.handle('delete-comparison', async (_, id: number) => {
  return db.deleteComparison(id)
})

ipcMain.handle('save-setting', async (_, key: string, value: string) => {
  return db.saveEncryptedSetting(key, value)
})

ipcMain.handle('get-setting', async (_, key: string) => {
  return db.getDecryptedSetting(key)
})

ipcMain.handle('check-python-status', async () => {
  return pythonClient.checkStatus()
})

ipcMain.handle('download-model', async (_, model: string) => {
  try {
    await pythonClient.downloadModel(model, {
      onProgress: (progress, message) => {
        mainWindow?.webContents.send('download-progress', progress, message)
      },
    })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message || String(error) }
  }
})
