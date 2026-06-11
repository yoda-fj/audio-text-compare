import React, { useRef, useEffect, useState } from 'react'
import { Play, Pause } from 'lucide-react'

interface AudioPlayerProps {
  /** URL do áudio (file:// ou app-audio://) */
  src: string
  /** Tempo inicial do chunk em segundos */
  startS: number
  /** Tempo final do chunk em segundos */
  endS: number
  /** Callback quando o áudio termina de tocar o chunk */
  onEnded?: () => void
  /** Callback quando o estado de play/pause muda */
  onPlayStateChange?: (isPlaying: boolean) => void
}

/**
 * Player de áudio segmentado: toca apenas um trecho (chunk) do áudio.
 * Quando atinge o `endS`, pausa automaticamente.
 */
const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  startS,
  endS,
  onEnded,
  onPlayStateChange,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)

  const chunkDuration = Math.max(0.1, endS - startS)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      const t = audio.currentTime
      setCurrentTime(t)
      if (t >= endS) {
        audio.pause()
        audio.currentTime = startS
        setIsPlaying(false)
        onPlayStateChange?.(false)
        onEnded?.()
      }
    }

    const handleEnded = () => {
      setIsPlaying(false)
      onPlayStateChange?.(false)
      onEnded?.()
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('ended', handleEnded)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('ended', handleEnded)
    }
  }, [src, startS, endS, onEnded, onPlayStateChange])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      onPlayStateChange?.(false)
    } else {
      // Se estiver fora do range do chunk, volta para o início
      if (audio.currentTime < startS || audio.currentTime >= endS) {
        audio.currentTime = startS
      }
      audio.play()
      setIsPlaying(true)
      onPlayStateChange?.(true)
    }
  }

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const progress = chunkDuration > 0
    ? Math.min(1, Math.max(0, (currentTime - startS) / chunkDuration))
    : 0

  return (
    <div className="flex items-center gap-3 bg-gray-100 rounded-lg px-3 py-2">
      <audio ref={audioRef} src={src} preload="metadata" />
      
      <button
        onClick={togglePlay}
        className="w-8 h-8 flex items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-700 transition-colors shrink-0"
        title={isPlaying ? 'Pausar' : 'Tocar chunk'}
      >
        {isPlaying ? (
          <Pause className="w-4 h-4" />
        ) : (
          <Play className="w-4 h-4 ml-0.5" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="h-1.5 bg-gray-300 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 rounded-full transition-all duration-100"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{formatTime(Math.max(0, currentTime - startS))}</span>
          <span>{formatTime(chunkDuration)}</span>
        </div>
      </div>
    </div>
  )
}

export default AudioPlayer
