import { createVuePlugin } from 'vite-plugin-vue2'
import { VuetifyResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';

module.exports = {
  plugins: [
    createVuePlugin(),
    Components({
      resolvers: [VuetifyResolver()],
    }),
  ]
};