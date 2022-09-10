import Vue from "vue"
import Vuex from "vuex"

Vue.use(Vuex)

export default new Vuex.Store({
  state: {
    loading: false,
    error : false
  },
  mutations: {
    startLoading(state) {
      state.loading = true
    },
    stopLoading(state) {
      state.loading = false
    }
  },
  actions: {},
  modules: {},
})
