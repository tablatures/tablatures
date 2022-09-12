<template>
  <div>
    <v-system-bar app dark color="blue darken-3" style="position: relative">
      <v-spacer></v-spacer>
      <span>
        ⭐️ If you like Tablatures, give it a star on
        <a href="https://github.com/mlhoutel/Tablatures" style="color: rgba(255, 255, 255, 0.7)" target="_blank">GitHub</a>
        ⭐️
      </span>
      <v-spacer></v-spacer>
    </v-system-bar>

    <v-app-bar app dark dense color="primary" flat class="ma-0" style="position: relative">
      <v-toolbar-title class="text-h4" style="font-size: 1.4em !important; cursor: pointer" @click="goHome"> Tablatures </v-toolbar-title>

      <v-spacer></v-spacer>

      <v-switch
        v-model="$vuetify.theme.dark"
        :prepend-icon="$vuetify.theme.dark ? 'mdi-moon-waning-crescent' : 'mdi-white-balance-sunny'"
        :color="$vuetify.theme.dark ? 'yellow' : 'white'"
        :hide-details="true"
        inset
      ></v-switch>

      <v-text-field
        v-model="localQuery"
        @focus="search = true"
        @blur="search = false"
        @change="goSearch"
        placeholder="Search"
        class="expanding-search"
        :class="{ closed: !search }"
        prepend-inner-icon="mdi-magnify"
        filled
        dense
        outlined
        :hide-details="true"
      ></v-text-field>

      <v-progress-linear :active="$store.state.loading" :indeterminate="true" absolute bottom color="blue darken-4"></v-progress-linear>
    </v-app-bar>
    
    <v-overlay z-index="99999" :value="$store.state.loading" style="height: 100vh; ">
      <v-col>
        <v-row align="center" justify="center">
          <v-progress-circular indeterminate color="primary" size="70" width="6" />
        </v-row>
        <v-row class="pa-5">
          <b>LOADING...</b>
        </v-row>
      </v-col>
    </v-overlay>
  </div>
</template>

<script>
import Vue from "vue"

export default Vue.extend({
  name: "AppBar",
  data() {
    return {
      search: false,
      localQuery: ""
    }
  },
  mounted() {
    this.localQuery = this.$store.state.query
  },
  methods: {
    goHome() {
      if (this.$route.name != "Home") {
        this.$router.push({ name: "Home" })
      }
    },
    goSearch() {
      this.$store.commit("searchQuery", this.localQuery)

      if (this.$route.name == "Search" && this.$route.query?.query != this.localQuery) {
        this.$router.push({ name: "Search", query: { query: this.localQuery } })
      } else {
        this.$router.push({ name: "Search", query: { query: this.localQuery } })
      }
    },
    goImport() {
      if (this.$route.name != "Import") {
        this.$router.push({ name: "Import" })
      }
    },
    goDocs() {
      if (this.$route.name != "Docs") {
        this.$router.push("docs")
      }
    },
    goAbout() {
      if (this.$route.name != "About") {
        this.$router.push({ name: "About" })
      }
    },
    goGitHub() {
      //window.location.href = "https://github.com/mlhoutel/Tablatures"
    },
  },
})
</script>

<style lang="scss">
.expanding-search {
  max-width: 300px !important;
  transition: max-width 0.3s !important;
}
.expanding-search.closed {
  max-width: 45px !important;
}
</style>
