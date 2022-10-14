<template>
  <v-footer color="primary darken-3" dark padless>
    <v-card-text flat tile width="100%" class="text-center">
      <v-btn icon class="mx-4" href="https://github.com/mlhoutel/Tablatures" target="_blank">
        <v-icon>mdi-github</v-icon>
      </v-btn>

      <v-btn icon class="mx-4" href="https://github.com/mlhoutel/Tablatures/blob/main/LICENSE" target="_blank">
        <v-icon>mdi-file-document</v-icon>
      </v-btn>

      <v-btn icon class="mx-4" href="https://github.com/mlhoutel/Tablatures/blob/main/README.md" target="_blank">
        <v-icon>mdi-guitar-pick</v-icon>
      </v-btn>
    </v-card-text>
    <v-divider inset class="mx-8"></v-divider>
    <v-card-text justify="center" class="text-center"> <b>tablatures</b> - an open source project for <b>guitar players</b> </v-card-text>
  </v-footer>
</template>
<script>
import Vue from "vue"

export default Vue.extend({
  name: "AppFooter",
})
</script>
