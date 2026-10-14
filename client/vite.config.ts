import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "LabDesk",
        short_name: "LabDesk",
        description: "Book lab slots and equipment, and check in at the door.",
        // Installed on a phone, the app opens straight to the scanner.
        start_url: "/scan",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        // The light theme's page background (--bench); the page sets the
        // browser theme-color per theme at runtime.
        background_color: "#F3F4F1",
        theme_color: "#F3F4F1",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // App shell offline; the API is never cached or served from the SW.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in dev, so the /api/auth refresh cookie just works.
    proxy: { "/api": "http://localhost:4000" },
  },
});
