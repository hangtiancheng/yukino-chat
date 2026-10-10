import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryPlugin } from "@yukino.js/sentry/vite";
import { fileURLToPath } from "node:url";
import { VitePWA } from "vite-plugin-pwa";
import { resolve, join } from "node:path";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
function moveSourcemaps(): Plugin {
  let outDir = "dist";
  return {
    name: "move-sourcemaps",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const mapDir = join(outDir, ".sourcemaps");
      const mapFiles: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (fullPath !== mapDir) walk(fullPath);
          } else if (entry.name.endsWith(".map")) {
            mapFiles.push(fullPath);
          }
        }
      };
      walk(outDir);
      if (mapFiles.length === 0) return;
      mkdirSync(mapDir, { recursive: true });
      for (const file of mapFiles) {
        renameSync(file, join(mapDir, file.slice(file.lastIndexOf("/") + 1)));
      }
      this.info(`moved ${mapFiles.length} sourcemap file(s) to ${mapDir}`);
    },
  };
}

function fetchPriorityHints(): Plugin {
  return {
    name: "fetch-priority-hints",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replace(
          /<link rel="stylesheet"/g,
          '<link rel="stylesheet" fetchpriority="high"',
        )
        .replace(
          /<script type="module" crossorigin/g,
          '<script type="module" crossorigin fetchpriority="high"',
        );
    },
  };
}

const isProd = process.env.NODE_ENV === "production";

export default defineConfig({
  publicDir: resolve(import.meta.dirname, "public"),
  plugins: [
    react(),
    tailwindcss(),
    moveSourcemaps(),
    fetchPriorityHints(),
    sentryPlugin({ dsn: "/api/log" }),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "favicon.ico",
        "apple-touch-icon-180x180.png",
      ],
      manifest: {
        name: "resume",
        short_name: "resume",
        description: "resume",
        theme_color: "#f05138",
        background_color: "#f05138",
        display: "standalone",
        scope: isProd ? "/yukino-chat/" : "/",
        start_url: isProd ? "/yukino-chat/" : "/",
        icons: [
          {
            src: "pwa-64x64.png",
            sizes: "64x64",
            type: "image/png",
          },
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    sourcemap: "hidden",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
