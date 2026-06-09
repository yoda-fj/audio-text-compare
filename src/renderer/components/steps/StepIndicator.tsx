import { FileText, FileAudio, BarChart3, Check } from 'lucide-react'

interface StepIndicatorProps {
  currentStep: number
}

const steps = [
  { label: 'Documento', icon: FileText },
  { label: 'Áudio / Transcrição', icon: FileAudio },
  { label: 'Comparativo', icon: BarChart3 },
]

export default function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-start w-full mb-8">
      {steps.map((step, index) => {
        const stepNum = index + 1
        const isActive = currentStep === stepNum
        const isCompleted = currentStep > stepNum
        const isLast = index === steps.length - 1
        const Icon = step.icon

        return (
          <div key={step.label} className={`flex items-center ${isLast ? '' : 'flex-1'}`}>
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                  isActive
                    ? 'bg-primary-600 border-primary-600 text-white'
                    : isCompleted
                    ? 'bg-green-50 border-green-500 text-green-600'
                    : 'bg-gray-100 border-gray-300 text-gray-400'
                }`}
              >
                {isCompleted ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
              </div>
              <span
                className={`mt-2 text-sm font-medium text-center whitespace-nowrap ${
                  isActive
                    ? 'text-primary-700'
                    : isCompleted
                    ? 'text-green-700'
                    : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <div
                className={`flex-1 h-0.5 mt-5 mx-2 ${
                  isCompleted ? 'bg-green-400' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
