/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      keyframes: {
        breathing: {
          '0%, 100%': { opacity: '0.2' },
          '50%': { opacity: '1' },
        }
      },
      animation: {
        breathing: 'breathing 4s ease-in-out infinite',
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',

        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        surface: 'var(--surface)',
        border: 'var(--border)',

        // Added mappings
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        input: 'var(--input)',
        ring: 'var(--ring)',
      },
    },
  },
  plugins: [],
}
