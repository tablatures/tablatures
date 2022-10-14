import Vue from "vue"
import App from "./App.vue"
import store from "./store"
import vuetify from "./plugins/vuetify"
import createApp from "vue"

Vue.config.productionTip = false
Vue.prototype.window = window

const app = new createApp({
  vuetify,
  store,
  render: (h) => h(App)
})

app.$mount("#app")
