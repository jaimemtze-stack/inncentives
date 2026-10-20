/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      // Visual language inspired by Toggl Track: deep plum navigation, purple
      // actions and a pink accent for the main call to action.
      colors: {
        brand: {
          50: '#f6f0fd',
          100: '#ecdffb',
          200: '#d9bff6',
          300: '#c09bef',
          400: '#a46ee6',
          500: '#9050da',
          600: '#7e3fbf',
          700: '#6a32a3',
          800: '#562a83',
          900: '#43226a',
          950: '#2c1338',
        },
        plum: {
          50: '#fbf9fc',
          100: '#f3eef5',
          200: '#e6dcea',
          300: '#c9b5d1',
          400: '#a58bb0',
          // Muted text: darker on light surfaces, lighter on dark ones (index.css).
          500: 'rgb(var(--plum-muted) / <alpha-value>)',
          600: '#5a3d66',
          700: '#412a4c',
          800: '#35203f',
          850: '#2f1b38',
          900: '#2c1338',
          950: '#1e1424',
        },
        accent: { 300: '#f2a9e9', 400: '#e57cd8', 500: '#d6409f' },
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
