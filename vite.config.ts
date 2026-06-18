import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
  },
  base: "/sprites/",
  build: {
    target: "esnext",
    minify: "terser",
    terserOptions: {
      module: true,
      compress: {
        drop_console: true,
        toplevel: true,
        unsafe_math: true,
        passes: 10,
      },
    },
  },
});
