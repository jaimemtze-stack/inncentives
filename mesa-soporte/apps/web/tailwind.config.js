/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      // Inncentives colours (inncentives.neitek.com): golden yellow for actions,
      // warm neutrals and cream surfaces, the logo navy for the sidebar and
      // orange as the second chart series.
      colors: {
        brand: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbc52a',
          500: '#f2b20c',
          600: '#d99a06',
          700: '#b37905',
          800: '#8a5d0a',
          900: '#5c3d06',
          950: '#3d2805',
        },
        ink: {
          50: '#fbfaf6',
          100: '#f4f2ea',
          200: '#e7e4d8',
          300: '#cfcbbb',
          400: '#a7a290',
          // Muted text: darker on light surfaces, lighter on dark ones (index.css).
          500: 'rgb(var(--ink-muted) / <alpha-value>)',
          600: '#55513f',
          700: '#3d3a2c',
          800: '#2c2a1f',
          850: '#232118',
          900: '#2a2a12',
          950: '#171610',
        },
        navy: {
          100: '#e6e7f5',
          300: '#bfc1de',
          700: '#3a3c94',
          800: '#25266d',
          900: '#2d2e82',
        },
        accent: { 400: '#ee7d11' },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
