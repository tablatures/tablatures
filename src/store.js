import Vue from "vue"
import Vuex from "vuex"
import VuexPersistence from "vuex-persist"

import { fetchList, fetchTrack, fetchSound } from "./utils"

Vue.use(Vuex)

const persistence = new VuexPersistence({
  storage: window.localStorage,
  reducer: state => ({
    gitstar: state.gitstar,
    drawer: state.drawer,
    navigation: state.navigation,
    query: state.query,
    index: state.index,
    database: state.database,
    file: state.file
  })
})

/**
 * @data loading: overlay and loadbar
 * @data error: popup and handling
 * @data drawer: state of the side drawer
 * @data navigation: drawer selector
 * @data query: track search string
 * @data index: id of the search page
 * @data file: gp5 file storage
 * @data database: cache search by query>index>track
 */
export default new Vuex.Store({
  plugins:[persistence.plugin], 
  state: {
    loading: false,
    error: undefined,
    gitstar: true,
    drawer: false,
    navigation: "",
    query: "",
    index: 1,
    file: undefined,
    sound: undefined,
    database: {}
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
    },
    searchIndex(state, index) {
      state.index = index
    },
    clearList(state) {
      state.database = {}
    },
    displayError(state, error) {
      state.error = error
    },
    clearError(state) {
      state.error = undefined
    },
    setDrawer(state, drawer) {
      state.drawer = drawer
    },
    setNavigation(state, navigation) {
      state.navigation = navigation
    },
    displayGitstar(state, gitstar) {
      state.gitstar = gitstar
    },
    loadFile(state, file) {
      state.file = null // free memory
      state.file = file // fill memory
    },
    loadSound(state, sound) {
      state.sound = sound
    }
  },
  actions: {
    async fetchList({ state }, { source, pages } ) {
      await fetchList(source, pages, state.index, state.query, state.database)
    },
    async fetchTrack({ commit }, { source, target }) {
      commit("loadFile", await fetchTrack(source, target))
    },
    async fetchSound({ commit }) {
      commit("loadSound", await fetchSound())
    }
  }
})
