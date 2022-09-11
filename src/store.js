import Vue from "vue"
import Vuex from "vuex"

Vue.use(Vuex)

export default new Vuex.Store({
  state: {
    loading: false,
    error : false,
    query: "",
  },
  mutations: {
    startLoading(state) {
      state.loading = true
    },
    stopLoading(state) {
      state.loading = false
    },
    searchQuery(state, query) {
      state.query = query
    }
  },
  actions: {},
  modules: {},
})
