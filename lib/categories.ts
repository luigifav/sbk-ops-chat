export interface Category {
  id: string
  label: string
  color: string        // Tailwind bg color class
  textColor: string    // Tailwind text color class
  borderColor: string  // Tailwind border color class
}

export const CATEGORIES: Category[] = [
  {
    id: 'bradesco',
    label: 'Bradesco',
    color: 'bg-red-50',
    textColor: 'text-red-700',
    borderColor: 'border-red-200',
  },
  {
    id: 'agibank',
    label: 'Agibank',
    color: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-200',
  },
  {
    id: 'eagle',
    label: 'Eagle',
    color: 'bg-purple-50',
    textColor: 'text-purple-700',
    borderColor: 'border-purple-200',
  },
  {
    id: 'zurich',
    label: 'Zurich',
    color: 'bg-orange-50',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-200',
  },
  {
    id: 'geral',
    label: 'Geral',
    color: 'bg-gray-50',
    textColor: 'text-gray-700',
    borderColor: 'border-gray-200',
  },
  {
    id: 'processos-internos',
    label: 'Processos Internos',
    color: 'bg-green-50',
    textColor: 'text-green-700',
    borderColor: 'border-green-200',
  },
]

export function getCategoryById(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[4] // fallback to 'geral'
}
