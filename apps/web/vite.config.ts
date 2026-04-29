import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const isGitHubPagesBuild = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base =
  process.env.VITE_BASE_PATH ??
  (isGitHubPagesBuild && repositoryName ? `/${repositoryName}/` : "/");
const apiBaseUrl = process.env.VITE_API_BASE_URL;
const apiUrl = apiBaseUrl ? new URL(apiBaseUrl) : undefined;
const apiPathPrefix = `${trimTrailingSlash(apiUrl?.pathname ?? "")}/api/`;
const apiRuntimeCachePattern = apiUrl
  ? new RegExp(`^${escapeRegExp(apiUrl.origin)}${escapeRegExp(apiPathPrefix)}`)
  : /\/api\//;

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "min-kb-app",
        short_name: "min-kb-app",
        description: "Agent-first Copilot chat app for min-kb-store.",
        theme_color: "#101828",
        background_color: "#101828",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          {
            src: `${base}favicon.svg`,
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: apiRuntimeCachePattern,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-cache",
              cacheableResponse: {
                statuses: [200],
              },
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60,
              },
              networkTimeoutSeconds: 1,
            },
          },
          {
            urlPattern: ({ request }) =>
              ["style", "script", "worker", "image", "font"].includes(
                request.destination
              ),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "asset-runtime-cache",
              cacheableResponse: {
                statuses: [200],
              },
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 4173,
    allowedHosts: [
      "minipc.local",
      "minipc-wsl",
      "minipc-wsl.tail2e322f.ts.net",
    ],
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
