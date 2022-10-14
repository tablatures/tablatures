<template>
  <div>
    <v-system-bar v-if="$store.state.gitstar" app dark color="primary darken-3" style="position: relative">
      <v-spacer></v-spacer>
      <span>
        ⭐️ If you like Tablatures, give it a star on
        <a href="https://github.com/mlhoutel/Tablatures" style="color: rgba(255, 255, 255, 0.7)" target="_blank">GitHub</a>
        ⭐️
      </span>
      <v-spacer></v-spacer>
      <v-icon @click="$store.commit('displayGitstar', false)">mdi-close</v-icon>
    </v-system-bar>

    <v-app-bar app flat color="transparent" class="ma-0" style="position: relative">
      <div class="pr-2" style="cursor: pointer" @click="openDrawer">
        <v-img src="/logo.svg" width="48px" contain />
      </div>

      <v-toolbar-title style="cursor: pointer" @click="openDrawer">
        <div class="text-h4" style="font-size: 1.4em !important">Tablatures</div>
      </v-toolbar-title>

      <v-spacer></v-spacer>

      <v-switch
        v-model="$vuetify.theme.dark"
        :prepend-icon="$vuetify.theme.dark ? 'mdi-moon-waning-crescent' : 'mdi-white-balance-sunny'"
        :color="$vuetify.theme.dark ? 'yellow' : 'white'"
        :hide-details="true"
        inset
      ></v-switch>

      <v-btn
        color="text--darken"
        style="opacity: 0.6; background-color: rgba(255, 255, 255, 0.06)"
        outlined
        height="40px"
        width="45px"
        min-width="45px"
        @click="openDrawer"
      >
        <v-icon>mdi-magnify</v-icon>
      </v-btn>
    </v-app-bar>

    <v-overlay z-index="9999999" :value="$store.state.loading" style="height: 100vh">
      <v-col>
        <v-row align="center" justify="center">
          <v-progress-circular indeterminate color="primary" size="70" width="6" />
        </v-row>
        <v-row class="pa-5">
          <b>LOADING...</b>
        </v-row>
      </v-col>
    </v-overlay>

    <div v-if="$store.state.error" style="position: fixed; bottom: 0px; z-index: 999999; width: 100%; padding: 10px">
      <v-alert class="py-4" border="left" colored-border dense dismissible elevation="10" type="error" width="100%" @input="closeError">
        <b>{{ $store.state.error }}</b>
      </v-alert>
    </div>
  </div>
</template>

<script>
import Vue from "vue"

export default Vue.extend({
  name: "AppBar",
  mounted() {
    this.$store.commit("stopLoading")
  },
  methods: {
    closeError() {
      this.$store.commit("clearError")
    },
    openDrawer() {
      this.$store.commit("setDrawer", true)
    },
  },
})
</script>
