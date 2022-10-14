import Vue from "vue"
import Vuetify from "vuetify/lib/framework"
import '@mdi/font/css/materialdesignicons.css'

import colors from 'vuetify/lib/util/colors'

Vue.use(Vuetify, {
  options: {
    customProperties: true,
  },
})

export default new Vuetify({
  theme: {
    themes: {
      light: {
        primary: colors.deepPurple,
        secondary: colors.grey.darken1,
        accent: colors.shades.black,
        error: colors.red.accent3,
      },
      dark: {
        primary: colors.deepPurple,
        secondary: colors.grey.darken1,
        accent: colors.shades.black,
        error: colors.red.accent3,
      },
    },
  },
})
