<template>
  <v-col>
    <v-row>
      <tab-sheet :file="file" ref="reader" />
    </v-row>

    <v-row v-if="!display" class="centered">
      <div class="container">
        <v-btn rounded dark color="primary" @click="selectTrack">
          <v-icon left dark> mdi-music </v-icon>
          Load a track
        </v-btn>
      </div>
    </v-row>
  </v-col>
</template>

<script>
import Vue from "vue"
import TabSheet from "../components/TabSheet.vue"

export default Vue.extend({
  name: "AppContent",
  components: { TabSheet },
  data() {
    return {
      loading: false,
      loaded: false,
      reader: null,
    }
  },
  computed: {
    file() {
      return this.$store.state.file
    },
    display() {
      // also display during 'loading' to avoid
      // 0px width element (cancel alphaTab rendering)
      return this.loading || this.loaded
    },
  },
  mounted() {
    if (this.file) {
      // this.loadFile()
    }
  },
  methods: {
    async loadFile() {
      this.loading = false
      this.loaded = false

      this.reader = this.$refs.reader

      this.$store.commit("startLoading")
      this.loading = true

      await this.reader.loadSoundsBytes()
      await this.reader.loadScoreBytes()

      this.loading = false
      this.loaded = true
      this.$store.commit("stopLoading")

      this.reader.render()
    },
    selectTrack() {
      this.$store.commit("setDrawer", true)
      this.$store.commit("setNavigation", "search")
    },
  },
  watch: {
    file() {
      this.loadFile()
    },
  },
})
</script>
