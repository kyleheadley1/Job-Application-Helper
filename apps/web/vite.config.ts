import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  /** One `.env` at monorepo root (same file the API loads). */
  envDir: path.resolve(__dirname, "../.."),
  plugins: [react()],
});
