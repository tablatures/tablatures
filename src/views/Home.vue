<template>
  <v-container class="tab-scrollable">
    <v-card tile class="text-center py-10">
      <p class="text-center text-h2 text--primary">Read and play tabs quickly</p>

      <div class="pb-5">With tablatures, it's never been easier to learn a new music score...</div>

      <div>
        <v-btn rounded color="primary" dark class="ma-2" @click="goImport">
          <v-icon left>mdi-upload</v-icon>
          Try Importing
        </v-btn>
        <v-btn rounded color="primary" dark class="ma-2" @click="goSearch">
          <v-icon left>mdi-magnify</v-icon>
          Search a score
        </v-btn>
        <v-btn rounded color="primary" dark class="ma-2" @click="goBrowse">
          <v-icon left>mdi-book-open-variant</v-icon>
          Browse the Docs
        </v-btn>
      </div>
    </v-card>

    <v-card tile height="300px">
      <v-flex>
        <v-parallax height="300" src="@/assets/imgs/score.jpg"></v-parallax>
      </v-flex>
    </v-card>

    <v-card tile class="pa-4">
      <v-card-title primary-title>
        <h3 class="headline text-h4 text-center" style="font-size: 1.4em !important">Tablatures is an open source project</h3>
      </v-card-title>
      <div class="pa-5 pt-0">
        <span>It has been built with open sources libraries, and it is free to access and to download. </span>
        <span>It does not store any of your datas, it does not use cookies or any other annoying things. </span>
      </div>
      <div class="text-center pa-3 pb-12">
        <v-btn rounded color="primary" dark x-large href="https://github.com/mlhoutel/Tablatures/" target="_blank">
          <v-icon left large class="pr-2">mdi-github</v-icon>
          Browse source code
        </v-btn>
      </div>

      <v-card-title primary-title>
        <h3 class="headline text-h4 text-center" style="font-size: 1.4em !important">Libraries used for the design of the website</h3>
      </v-card-title>
      <v-row dense justify="center">
        <v-col md="4">
          <v-card min-height="360">
            <v-img src="https://www.synolia.com/wp-content/uploads/2019/12/header-vue-js.jpg" height="200px" gradient="to bottom, rgba(0,0,0,.1), rgba(0,0,0,.5)"></v-img>
            <v-card-title>Vue</v-card-title>
            <v-card-subtitle>An well known, open source progressive framework for javascript.</v-card-subtitle>
            <v-card-text>
              <v-btn href="https://vuejs.org/" target="_blank" block color="primary">Browse</v-btn>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col md="4">
          <v-card min-height="360">
            <v-img
              src="https://inceptum-stor.icons8.com/171gfWxHN1Pz/1%20E5rLwFafmf6KdH7B2sLELg.png"
              height="200px"
              gradient="to bottom, rgba(0,0,0,.1), rgba(0,0,0,.5)"
            ></v-img>
            <v-card-title>Vuetify</v-card-title>
            <v-card-subtitle>A Vue UI Library with beautifully handcrafted Material Components.</v-card-subtitle>
            <v-card-text>
              <v-btn href="https://vuetifyjs.com/en/" target="_blank" block color="primary">Browse</v-btn>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col md="4">
          <v-card min-height="360">
            <v-img
              src="https://repository-images.githubusercontent.com/1491192/0376c980-c7a1-11ea-86af-11ce75ddcb47"
              height="200px"
              gradient="to bottom, rgba(0,0,0,.1), rgba(0,0,0,.5)"
            ></v-img>
            <v-card-title>alphaTab</v-card-title>
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

<script lang="ts">
import Vue from "vue"
export default Vue.extend({
  name: "Home",
  methods: {
    goImport() {
      this.$router.push({ name: "Import" })
    },
    goSearch() {
      this.$router.push({ name: "Search" })
    },
    goBrowse() {
      this.$router.push("docs")
    },
  },
})
</script>
