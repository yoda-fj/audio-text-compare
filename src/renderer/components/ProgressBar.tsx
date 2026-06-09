import React from 'react'

interface ProgressBarProps {
  progress: number
  label?: string
  showPercentage?: boolean
  variant?: 'default' | 'indigo' | 'green'
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  label,
  showPercentage = true,
  variant = 'default',
}) => {
  const clamped = Math.min(100, Math.max(0, progress))

  const fillClass =
    variant === 'indigo'
      ? 'progress-bar-fill-indigo'
      : variant === 'green'
      ? 'progress-bar-fill-green'
      : 'progress-bar-fill'

  return (
    <div className="w-full">
      {(label || showPercentage) && (
        <div className="flex items-center justify-between mb-2">
          {label && (
            <span className="text-sm font-medium text-gray-700">{label}</span>
          )}
          {showPercentage && (
            <span className="text-sm font-semibold text-gray-900">{clamped}%</span>
          )}
        </div>
      )}
      <div className="progress-bar">
        <div className={`${fillClass} relative`} style={{ width: `${clamped}%` }}>
          {clamped > 5 && (
            <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
          )}
        </div>
      </div>
    </div>
  )
}

export default ProgressBar
