import { contextBridge, ipcRenderer } from 'electron'
import type { ReadDocumentOptions } from '../renderer/types'

export interface IElectronAPI {
  selectFile: (options: { filters: { name: string; extensions: string[] }[] }) => Promise<string | null>
  readDocument: (filePath: string, options?: ReadDocumentOptions) => Promise<{ text: string; error?: string }>
  transcribeAudio: (filePath: string, model: string) => Promise<{ text: string; error?: string }>
  compareTexts: (original: string, transcribed: string) => Promise<any[]>
  saveComparison: (data: any) => Promise<number>
  getComparisons: () => Promise<any[]>
  getComparison: (id: number) => Promise<any>
  deleteComparison: (id: number) => Promise<void>
  checkPythonStatus: () => Promise<{ ready: boolean; python?: string; message: string }>
  saveSetting: (key: string, value: string) => Promise<void>
  getSetting: (key: string) => Promise<string | null>
  onTranscriptionProgress: (callback: (progress: number, message: string) => void) => () => void
  downloadModel: (model: string) => Promise<{ success: boolean; error?: string }>
  onDownloadProgress: (callback: (progress: number, message: string) => void) => () => void
  getCheckpointStatus: (audioPath: string, model: string) => Promise<{ exists: boolean; completedChunks?: number; totalChunks?: number }>
  deleteCheckpoint: (audioPath: string, model: string) => Promise<void>
}

const api: IElectronAPI = {
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  readDocument: (filePath, options) => ipcRenderer.invoke('read-document', filePath, options),
  transcribeAudio: (filePath, model) => ipcRenderer.invoke('transcribe-audio', filePath, model),
  compareTexts: (original, transcribed) => ipcRenderer.invoke('compare-texts', original, transcribed),
  saveComparison: (data) => ipcRenderer.invoke('save-comparison', data),
  getComparisons: () => ipcRenderer.invoke('get-comparisons'),
  getComparison: (id) => ipcRenderer.invoke('get-comparison', id),
  deleteComparison: (id) => ipcRenderer.invoke('delete-comparison', id),
  checkPythonStatus: () => ipcRenderer.invoke('check-python-status'),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  onTranscriptionProgress: (callback) => {
    const handler = (_: any, progress: number, message: string) => callback(progress, message)
    ipcRenderer.on('transcription-progress', handler)
    return () => ipcRenderer.removeListener('transcription-progress', handler)
  },
  downloadModel: (model) => ipcRenderer.invoke('download-model', model),
  onDownloadProgress: (callback) => {
    const handler = (_: any, progress: number, message: string) => callback(progress, message)
    ipcRenderer.on('download-progress', handler)
    return () => ipcRenderer.removeListener('download-progress', handler)
  },
  getCheckpointStatus: (audioPath, model) => ipcRenderer.invoke('get-checkpoint-status', audioPath, model),
  deleteCheckpoint: (audioPath, model) => ipcRenderer.invoke('delete-checkpoint', audioPath, model),
}

contextBridge.exposeInMainWorld('electronAPI', api)

declare global {
  interface Window {
    electronAPI: IElectronAPI
  }
}
