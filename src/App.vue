<template>
  <v-app>
    <app-bar />
    <app-drawer />
    <v-main class="pa-0">
      <app-content />
    </v-main>
    <app-footer />
  </v-app>
</template>

<script>
import Vue from "vue"
import "./assets/global.css"

import AppBar from "./views/AppBar.vue"
import AppDrawer from "./views/AppDrawer.vue"
import AppFooter from "./views/AppFooter.vue"
import AppContent from "./views/AppContent.vue"

export default Vue.extend({
  name: "App",
  components: { AppBar, AppDrawer, AppFooter, AppContent },
})
</script>

<style lang="scss">
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
.at-cursor-bar {
  background: rgba(207, 127, 201, 0.25);
}
.at-cursor-beat {
  background: #673ab7;
  width: 3px;
}
.at-highlight * {
  fill: #673ab7;
  stroke: #673ab7;
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
