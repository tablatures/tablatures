<template>
  <v-app class="tab-app">
    <app-bar></app-bar>
    <v-main class="tab-main tab-fill">
      <v-container fluid>
        <router-view />
      </v-container>
    </v-main>
    <app-footer></app-footer>
  </v-app>
</template>

<script lang="ts">
import Vue from "vue"
import AppBar from "@/components/AppBar.vue"
import AppFooter from "./components/AppFooter.vue"
import "@/assets/global.css"

export default Vue.extend({
  name: "App",
  components: { AppBar, AppFooter },
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
