/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        twitch: {
          purple: '#9146FF',
          dark: '#0e0e10',
          darker: '#09090b',
          accent: '#bf94ff',
        },
        surface: {
          dark: 'rgba(18, 18, 24, 0.75)',
          border: 'rgba(255, 255, 255, 0.08)',
          glow: 'rgba(145, 70, 255, 0.15)',
        }
      },
      fontFamily: {
        sans: ['Onest', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        'glow-purple': '0 0 25px -5px rgba(145, 70, 255, 0.4)',
      },
      backdropBlur: {
        'glass': '16px',
      }
    },
  },
  plugins: [],
}
