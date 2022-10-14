<template>
  <v-navigation-drawer style="z-index: 99999" transition="slide-x-transition" app fixed permanent bottom width="100%" right v-if="drawer" v-model="drawer">
    <v-bottom-navigation mandatory v-model="navigation" color="primary darken-3" class="elevation-0">
      <v-btn value="import">
        <span>Import</span>
        <v-icon>mdi-upload</v-icon>
      </v-btn>

      <v-btn value="search">
        <span>Search</span>
        <v-icon>mdi-magnify</v-icon>
      </v-btn>

      <v-btn value="about">
        <span>About</span>
        <v-icon>mdi-book-open-variant</v-icon>
      </v-btn>
    </v-bottom-navigation>

    <v-btn
      color="text--darken"
      style="opacity: 0.6; background-color: rgba(255, 255, 255, 0.06); position: absolute; right: 16px; top: 8px"
      outlined
      height="40px"
      width="45px"
      min-width="45px"
      @click="drawer = false"
    >
      <v-icon>mdi-close</v-icon>
    </v-btn>

    <div class="pa-3">
      <import v-if="navigation == 'import'" @update="drawer = false" />
      <search v-if="navigation == 'search'" @update="drawer = false" />
      <about v-if="navigation == 'about'" />
    </div>
  </v-navigation-drawer>
</template>

<script>
import Vue from "vue"
import Import from "../components/Import.vue"
import Search from "../components/Search.vue"
import About from "../components/About.vue"

/**
 * @emit close when track selected
 */
export default Vue.extend({
  name: "AppDrawer",
  components: { Import, Search, About },
  computed: {
    drawer: {
      get() {
        return this.$store.state.drawer
      },
      set(value) {
        this.$store.commit("setDrawer", value)
      },
    },
    navigation: {
      get() {
        return this.$store.state.navigation
      },
      set(value) {
        this.$store.commit("setNavigation", value)
      },
    },
  },
})
</script>
