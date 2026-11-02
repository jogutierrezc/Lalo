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
        // Tally Studio: paleta adicional, no sustituye a twitch ni a surface
        tally: {
          red: '#FF2A2A',
          'red-ink': '#FF4A4A',
          dark: '#16191C',
          onyx: '#1E2227',
          'onyx-2': '#242A31',
          white: '#F5F6F8',
          line: '#2E343B',
          muted: '#9AA1AB',
          off: '#3A4047',
          ok: '#3DDC97',
          warn: '#FFB020',
          error: '#FFB4B4',
        },
        surface: {
          dark: 'rgba(18, 18, 24, 0.75)',
          border: 'rgba(255, 255, 255, 0.08)',
          glow: 'rgba(145, 70, 255, 0.15)',
        }
      },
      fontFamily: {
        sans: ['Onest', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Tally Studio: títulos, interfaz y datos
        'tally-display': ['Sora', 'Segoe UI', 'system-ui', 'sans-serif'],
        'tally-ui': ['Figtree', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        'tally-mono': ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
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
