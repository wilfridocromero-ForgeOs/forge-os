import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";

const appVersion = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;
const appBuildTime = Date.now();

function appVersionManifest() {
  return {
    name: "orvesen-version-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version: appVersion, built_at: appBuildTime }),
      });
    },
  };
}

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
    "import.meta.env.VITE_APP_BUILD_TIME": JSON.stringify(appBuildTime),
  },
  plugins: [
    react(),
    tailwindcss(),
    appVersionManifest(),
  ],
});
