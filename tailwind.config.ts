import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand palette from the Kasir Siluman logo (ghost mascot). Token
        // names are kept the same as before so every existing bg-navy /
        // text-teal / bg-orange / bg-cream class across the app just picks
        // up the new hex values automatically.
        navy: "#191970", // Primary (Navy Blue)
        teal: "#006400", // Accent (Dark Green)
        orange: "#8B4513", // Text/Detail (Brown)
        cream: "#F5F5DC", // Background (Cream)
        light: "#EFE9DA",
      },
    },
  },
  plugins: [],
};

export default config;
