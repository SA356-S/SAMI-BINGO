/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: {
          bg: '#0b0f1a',
          card: '#121829',
          border: '#1e293b',
          accent: '#6366f1',
          success: '#22c55e',
          danger: '#ef4444',
          warn: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
};
