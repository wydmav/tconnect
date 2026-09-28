import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['var(--font-grotesk)', 'sans-serif'], mono: ['var(--font-mono)', 'monospace'] },
      colors: {
        surface: { lowest: '#0a0e18', low: '#0f131d', base: '#171b26', high: '#222736', border: '#2a3144' },
        brand: { orange: '#f05e17', orangeDark: '#d94c0b', cyan: '#06b6d4', emerald: '#10b981', purple: '#a855f7' },
      },
    },
  },
  plugins: [],
} satisfies Config;