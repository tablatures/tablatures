<template>
  <div>
    <v-system-bar app fixed dark color="blue darken-3">
      <v-spacer></v-spacer>
      <span>
        ⭐️ If you like Tablatures, give it a star on
        <a href="https://github.com/mlhoutel/Tablatures" style="color: rgba(255, 255, 255, 0.7)" target="_blank">GitHub</a>
        ⭐️
      </span>
      <v-spacer></v-spacer>
    </v-system-bar>

    <v-app-bar app fixed dark dense color="primary" flat>
      <v-app-bar-nav-icon @click="drawer = !drawer"></v-app-bar-nav-icon>
      <v-toolbar-title class="text-h4" style="font-size: 1.4em !important; cursor: pointer" @click="goHome"> Tablatures </v-toolbar-title>

      <v-spacer></v-spacer>

      <v-text-field
        v-model="query"
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

      <v-btn icon>
        <v-icon>mdi-dots-vertical</v-icon>
      </v-btn>

      <v-progress-linear :active="loading" :indeterminate="loading" absolute bottom color="deep-purple accent-4"></v-progress-linear>
    </v-app-bar>

    <v-navigation-drawer v-model="drawer" fixed temporary>
      <v-list-item>
        <v-list-item-content>
          <v-list-item-title class="text-h6">Tablatures</v-list-item-title>
          <v-list-item-subtitle>Read and play along</v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>

      <v-list dense nav>
        <v-list-item-group v-model="group" active-class="deep-purple--text text--accent-4">
          <v-list-item link @click="goImport">
            <v-list-item-icon>
              <v-icon>mdi-upload</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Import</v-list-item-title>
            </v-list-item-content>
          </v-list-item>

          <v-list-item link @click="goSearch">
            <v-list-item-icon>
              <v-icon>mdi-magnify</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Search</v-list-item-title>
            </v-list-item-content>
          </v-list-item>

          <v-list-item link @click="goDocs">
            <v-list-item-icon>
              <v-icon>mdi-book-open-variant</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Docs</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </v-list-item-group>
      </v-list>

      <template v-slot:append>
        <v-list dense nav>
          <v-list-item link @click="goAbout">
            <v-list-item-icon>
              <v-icon>mdi-help-circle</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>About</v-list-item-title>
            </v-list-item-content>
          </v-list-item>

          <v-list-item link @click="goGitHub">
            <v-list-item-icon>
              <v-icon>mdi-github</v-icon>
            </v-list-item-icon>
            <v-list-item-content>
              <v-list-item-title>Repository</v-list-item-title>
            </v-list-item-content>
          </v-list-item>
        </v-list>
      </template>
    </v-navigation-drawer>
  </div>
</template>
<script lang="ts">
import Vue from "vue"

export default Vue.extend({
  name: "AppBar",
  data() {
    return {
      loading: false,
      drawer: false,
      group: null,
      search: false,
      query: "",
    }
  },
  methods: {
    goHome() {
      if (this.$route.name != "Home") {
        this.$router.push({ name: "Home" })
      }
    },
    goSearch() {
      if (this.$route.name == "Search" && this.$route.query?.query != this.query) {
        this.$router.push({ name: "Search", query: { query: this.query } })
      } else {
        this.$router.push({ name: "Search", query: { query: this.query } })
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
      window.location.href = "https://github.com/mlhoutel/Tablatures"
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
