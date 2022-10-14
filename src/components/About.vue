<template>
  <v-container>
    <v-card tile class="pa-4" height="calc(100vh - 130px)" style="overflow: auto">
      <v-card-title primary-title>
        <h3 class="headline text-h4 text-center" style="font-size: 1.7em; word-break: normal">Tablatures is an open source project</h3>
      </v-card-title>
      <div class="pa-5 pt-0">
        <span>It has been built with open sources libraries, and it is free to access and to download. </span>
        <span>It does not store any of your datas, it does not use cookies or any other annoying things. </span>
      </div>
      <div class="text-center pa-3 pb-12">
        <v-btn rounded color="primary" dark href="https://github.com/mlhoutel/Tablatures/" target="_blank">
          <v-icon left class="pr-2">mdi-github</v-icon>
          Browse source code
        </v-btn>
      </div>

      <v-card-title primary-title>
        <h3 class="headline text-h4 text-center" style="font-size: 1.4em; word-break: normal">Libraries used for the design of the website</h3>
      </v-card-title>
      <v-row dense justify="center">
        <v-col cols="12" sm="4">
          <v-card>
            <v-card-title>Vue</v-card-title>
            <v-card-subtitle>An well known, open source progressive framework for javascript.</v-card-subtitle>
            <v-card-text>
              <v-btn href="https://vuejs.org/" target="_blank" block color="primary">Browse</v-btn>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="4">
          <v-card>
            <v-card-title>Vuetify</v-card-title>
            <v-card-subtitle>A Vue UI Library with beautifully handcrafted Material Components.</v-card-subtitle>
            <v-card-text>
              <v-btn href="https://vuetifyjs.com/en/" target="_blank" block color="primary">Browse</v-btn>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="4">
          <v-card>
            <v-card-title>AlphaTab</v-card-title>
            <v-card-subtitle>An open source and cross platform guitar tablature rendering library.</v-card-subtitle>
            <v-card-text>
              <v-btn href="https://alphatab.net/" target="_blank" block color="primary">Browse</v-btn>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-card>
  </v-container>
</template>

<script>
import Vue from "vue"

export default Vue.extend({
  name: "About",
})
</script>
