/** @type {import('tailwindcss').Config} */

export default {

  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx,css}'],

  theme: {

    extend: {

      colors: {

        'bingo-dark': '#0A0F1D',

        /** Main Game + Card Selection page background */
        'theme-game': '#1a1a2e',

        'theme-navy': '#0A0F1D',

        'theme-surface': '#151b2e',

        'theme-elevated': '#1a2035',

        'theme-elevated-hover': '#222a42',

        'theme-panel': '#0d1220',

      },

      fontFamily: {

        sans: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],

      },

    },

  },

  plugins: [],

  safelist: [

    'bg-theme-navy',

    'bg-theme-game',

    'bg-theme-surface',

    'bg-theme-elevated',

    'bg-theme-panel',

    'hover:bg-theme-elevated-hover',

  ],

};

