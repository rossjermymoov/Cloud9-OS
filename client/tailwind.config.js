/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Moov design system tokens
        bg: {
          primary: '#0A0B1E',
          secondary: '#14162A',
          surface: '#1A1D35',
        },
        accent: {
          green: '#00C853',
          purple: '#7B2FBE',
          magenta: '#E91E8C',
          amber: '#FFC107',
          teal: '#00BCD4',
        },
        text: {
          primary: '#FFFFFF',
          secondary: '#AAAAAA',
          dark: '#222222',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        pill: '9999px',
        card: '14px',
        badge: '6px',
        tag: '4px',
      },
      spacing: {
        // 4px base scale
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
        16: '64px',
      },
      boxShadow: {
        'green-glow': '0 0 12px rgba(0, 200, 83, 0.4)',
        'card': '0 4px 24px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
};
