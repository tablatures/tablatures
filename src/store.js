import Vue from "vue"
import Vuex from "vuex"
import VuexPersistence from "vuex-persist"

Vue.use(Vuex)

const persistence = new VuexPersistence({
  storage: window.localStorage
})

const SOURCES = {
  GUITAR_PRO_TABS: 0
}

/**
 * loading: overlay and loadbar
 * error: popup and handling
 * drawer: state of the side drawer
 * navigation: drawer selector
 * query: track search string
 * index: id of the search page
 * file: gp5 file storage
 * database: cache search by query>index>track
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
    loadFile(state, file) {
      state.file = file
    },
    appendList(state, { query, index, item }) {
      // initialise query map if needed 
      if (!state.database[query]) state.database[query] = {}

      // copy current list and check if empty
      const current = state.database[query][index] || []

      // concatenate existing list and new item
      state.database[query][index] = [...current, item]
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
    }
  },
  actions: {
    /**
     * Proxy the request through api.allorigins.win to avoid CORS issues
     * @param {string} source url to request
     * @returns reponse as json (data in contents)
     */
    proxy({ }, source) {
      return fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(source)}`)
      .then(response => {
        return response.json()
      }).catch((error) => {
        throw new Error(`Error during the proxy request: ${error}`)
      })
    },

    /**
     * Extract the value between two tokens (exclusive)
     * @param {string} content the input string containing both tokens
     * @param {string} start_token the start token
     * @param {string} end_token the end token
     * @returns the value between the tokens
     */
    extract({ }, { content, start_token, end_token }) {
      const start_index = content.indexOf(start_token) + start_token.length
      const end_index = content.indexOf(end_token)
      return content.substring(0, end_index).substring(start_index);
    },

    /**
     * Fetch the list of track for the given source
     * @param {number} source database website
     * @param {number} pages number of pages to fetch
     */
    async fetchList({ commit, dispatch, state }, { source, pages }) {
      commit("startLoading")

      const index = state.index
      
      switch (source) {
        case SOURCES.GUITAR_PRO_TABS: {
          await dispatch("fetchListGuitarProTabs", { pages, index })
        } break;
        default:
          throw new Error("No source specified for the list scrapping.")
      }

      commit("stopLoading")
    },

    /**
     * Fetch the list of track for guitarprotabs
     * @param {number} pages number of pages to fetch
     * @param {number} index index of the current page
     */
    async fetchListGuitarProTabs({ commit, state, dispatch }, { pages, index }) {
      
      if (pages < 1) return // Stop recursive call

      // Check if a value is already stored in the local database
      // TODO: Could add an expiration date to cache if data can be stale
      if (state.database[state.query]?.[index]?.length) {

        // do not need to fetch again, go directly to the recursive call
        await dispatch("fetchListGuitarProTabs", { pages: pages - 1, index: index + 1 })

        // bypass the rest, we already have the required datas
        return
      }
      
      const parser = new DOMParser();
      const source = `https://www.guitarprotabs.net/artist/${state.query}/${index}`
      const content = await dispatch("proxy", source)
      let found_tabs = false // have we reached the end ?

      // Extract the page table
      const source_table = await dispatch("extract", {
        content: content.contents,
        start_token: '<table class="table table-striped">',
        end_token: '</table>',
      })

      // Virtualize an html table element for queries
      const fragment = parser.parseFromString(`<table>${source_table}</table>`, "text/html");
     
      const table = fragment.getElementsByTagName("table")[0]
      for (const row of table.rows) {
        
        const firstCell = row.cells[0].firstChild
        const trackLink = row.cells[1].firstChild.firstChild
        const groupLink = row.cells[1].children[2]

        const inner = row.cells[2].innerHTML.split("<br>")[1]

        const parsed = parser.parseFromString(String(inner), "text/html");
        const links = parsed.getElementsByTagName("a")
        const album = links.length ? links[0].innerHTML : "-"

        const [views, tracks] = row.cells[3].innerHTML.split("<br>")

        found_tabs = true

        const track = {
          source: SOURCES.GUITAR_PRO_TABS,
          type: firstCell.innerHTML,
          track: {
            href: trackLink?.attributes.href.value, // get relative
            title: trackLink?.title,
          },
          group: {
            href: groupLink?.attributes.href.value, // get relative
            title: groupLink?.title,
          },
          album: album,
          views: views?.split("# Views ")[1],
          tracks: tracks?.split("# Tracks ")[1]
        }
        
        commit("appendList", { query: state.query, index: index, item: track })
      }

      // recursive call
      if (found_tabs) {
        await dispatch("fetchListGuitarProTabs", { pages: pages - 1, index: index + 1 })
      }
    },

    /**
     * Fetch the track .pg5 file for the given source
     * @param {number} source database website
     * @param {object} target the track to fetch { title, href }
     */
    async fetchTrack({ commit, dispatch }, { source, target }) {
      commit("startLoading")

      switch (source) {
        case SOURCES.GUITAR_PRO_TABS: {
          await dispatch("fetchTrackGuitarProTabs", { target })
        } break;
        default:
          throw new Error("No source specified for the track scrapping.")
      }

      commit("stopLoading")
    },

    /**
     * Fetch the track .gp5 file for guitarprotabs
     * @param {object} target the track to fetch { title, href }
     */
    async fetchTrackGuitarProTabs({ commit, dispatch }, { target }) {

      const content = await dispatch("proxy", `https://www.guitarprotabs.net${target.href}`)

      // Extract the page download button link
      const href = await dispatch("extract", {
        content: content.contents,
        start_token: '<a class="btn btn-large pull-right" href="',
        end_token: '" rel="nofollow">Download Tab</a>',
      })

      const download = await dispatch("proxy", `https://www.guitarprotabs.net/${href}`)
      
      const raw = String(download.contents)
      const encoded = new Uint8Array(raw.length)

      for (let i = 0; i < raw.length; i++) {
        encoded[i] = raw.charCodeAt(i)
      }

      const blob = new Blob([encoded])
      
      commit("loadFile", new File([blob], target.title + ".gp5"))
    }
  }
})
