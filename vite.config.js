import { createVuePlugin } from 'vite-plugin-vue2'
import { VuetifyResolver } from 'unplugin-vue-components/resolvers';
import { VitePWA } from 'vite-plugin-pwa';
import Components from 'unplugin-vue-components/vite';

module.exports = {
  plugins: [
    createVuePlugin(),
    VitePWA({
      includeAssets: ['/favicon.ico'],
      manifest: {
        name: 'Tablatures',
        short_name: 'Tablatures',
        description: 'Tablature reader',
        theme_color: '#673AB7',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    }),
    Components({
      resolvers: [VuetifyResolver()],
    }),
  ],
  base: "/", // process.env.NODE_ENV === "production" ? "/Tablatures/" : "/",
  root: './src/',
  build: {
    outDir: '../dist'
  }
};