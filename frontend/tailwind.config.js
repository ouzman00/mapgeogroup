/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        mapgeo: {
          primary: "#123B5D",
          secondary: "#1B5A74",
          sand: "#C7B299",
          ivory: "#F7F5F2",
          ink: "#0F2131",
          mist: "#D8E2E7",
          line: "#E6E0D8",
        },
      },
      boxShadow: {
        soft: "0 18px 45px rgba(18, 59, 93, 0.08)",
        panel: "0 24px 60px rgba(18, 59, 93, 0.12)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.55)",
      },
      backgroundImage: {
        hero: "linear-gradient(135deg, rgba(18,59,93,0.98) 0%, rgba(27,90,116,0.94) 58%, rgba(199,178,153,0.7) 100%)",
        card: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(247,245,242,0.98) 100%)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
