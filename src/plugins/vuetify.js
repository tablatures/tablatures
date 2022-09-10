import Vue from "vue"
import Vuetify from "vuetify/lib/framework"
import '@mdi/font/css/materialdesignicons.css'

Vue.use(Vuetify, {
  options: {
    customProperties: true,
  },
})

export default new Vuetify({
  theme: {
    themes: {
      light: {},
      dark: {},
    },
  },
})
