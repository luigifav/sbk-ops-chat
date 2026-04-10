import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
      },
      colors: {
        'brand-turquesa': '#01B2AA',
        'brand-verde-medio': '#2A7A6F',
        'brand-verde-escuro': '#1F3A3A',
        'brand-gelo': '#EEF0F4',
        'brand-cinza-escuro': '#24262D',
        'brand-cinza-chumbo': '#4B4B4B',
        // Alias kept for backward-compat (Recharts inline colors, spinners not being redesigned)
        primary: {
          DEFAULT: '#01B2AA',
          dark: '#2A7A6F',
          light: 'rgba(1,178,170,0.1)',
        },
      },
    },
  },
  plugins: [],
}

export default config
