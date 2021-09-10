<template>
  <v-app>
    <v-app-bar app color="primary" dark>
      <div class="d-flex align-center">
        <v-img
          alt="Vuetify Logo"
          class="shrink mr-2"
          contain
          src="https://cdn.vuetifyjs.com/images/logos/vuetify-logo-dark.png"
          transition="scale-transition"
          width="40"
        />

        <v-img
          alt="Vuetify Name"
          class="shrink mt-1 hidden-sm-and-down"
          contain
          min-width="100"
          src="https://cdn.vuetifyjs.com/images/logos/vuetify-name-dark.png"
          width="100"
        />
      </div>

      <v-spacer></v-spacer>

      <v-btn href="https://github.com/vuetifyjs/vuetify/releases/latest" target="_blank" text>
        <span class="mr-2">Latest Release</span>
        <v-icon>mdi-open-in-new</v-icon>
      </v-btn>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script lang="ts">
import Vue from "vue"

export default Vue.extend({
  name: "App",

  data: () => ({
    //
  }),
})
</script>
<style lang="scss">
/* Bravura font from https://github.com/steinbergmedia/bravura/ */
@font-face {
  font-family: "alphaTab";
  src: url("assets/font/Bravura.eot");
  src: url("assets/font/Bravura.eot?#iefix") format("embedded-opentype"), url("assets/font/Bravura.woff") format("woff"),
    url("assets/font/Bravura.otf") format("opentype"), url("assets/font/Bravura.svg#Bravura") format("svg");
  font-weight: normal;
  font-style: normal;
}
.at-surface * {
  cursor: default;
  vertical-align: top;
  overflow: visible;
}
.at-surface-svg text {
  dominant-baseline: central;
}
.at {
  font-family: "alphaTab";
  speak: none;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size: 34px;
  overflow: visible !important;
}
</style>
