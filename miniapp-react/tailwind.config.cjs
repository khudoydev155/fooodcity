// tailwind.config.cjs
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}", "./index.html"],
  theme: {
    extend: {
      colors: {
        primary: "#FF6B00",
        bg: "#0F172A",
        "card-bg": "#1E293B",
        "sidebar-bg": "#0F172A",
        text: "#F8FAFC",
        gray: "#94A3B8",
        border: "#2E3A59",
        success: "#10B981",
        error: "#EF4444",
        warning: "#F59E0B",
        info: "#3B82F6",
        purple: "#8B5CF6"
      }
    }
  },
  plugins: []
};
