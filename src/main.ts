import Vue from "vue"
import App from "./App.vue"
import router from "./router"
import store from "./store"
import vuetify from "./plugins/vuetify"
import createApp from "vue"

Vue.config.productionTip = false
Vue.prototype.window = window

const app = new createApp({ router, store, vuetify, render: (h) => h(App) })
app.$mount("#app")
