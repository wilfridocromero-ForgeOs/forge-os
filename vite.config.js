import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";

const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;

function appVersionManifest() {
  return {
    name: "orvesen-version-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: appVersion }),
      });
    },
  };
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    appVersionManifest(),
  ],
});
