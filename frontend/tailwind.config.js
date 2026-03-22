/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        evload: {
          bg: 'var(--ev-bg)',
          surface: 'var(--ev-surface)',
          border: 'var(--ev-border)',
          accent: 'var(--ev-accent)',
          text: 'var(--ev-text)',
          muted: 'var(--ev-muted)',
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444',
        },
      },
    },
  },
  plugins: [],
}
