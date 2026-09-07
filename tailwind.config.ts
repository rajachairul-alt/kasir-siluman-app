import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#1F3A56",
        teal: "#2E7D5B",
        orange: "#C77B2C",
        cream: "#F5EFE0",
        light: "#EFE9DA",
      },
    },
  },
  plugins: [],
};

export default config;
