<template>
  <v-col>
    <v-row>
      <tab-sheet :file="file" :sound="sound" ref="reader" />
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
    sound() {
      return this.$store.state.sound
    },
    display() {
      // also display during 'loading' to avoid
      // 0px width element (cancel alphaTab rendering)
      return this.loading || this.loaded
    },
  },
  async mounted() {
    if (!this.file) return

    await this.loadTrack()
  },
  methods: {
    async loadTrack() {
      await this.loadSound()
      await this.loadFile()
    },
    async loadFile() {
      this.$store.commit("startLoading")
      this.loading = false
      this.loaded = false

      // Find the reader elem in the page
      this.reader = this.$refs.reader
      this.loading = true

      // Clear current alphaTab context
      this.reader.clearReset()

      // Load sound bytes from web
      await this.reader.loadSoundsBytes()

      // Load score from file
      await this.reader.loadScoreBytes()

      this.loading = false
      this.loaded = true
      this.$store.commit("stopLoading")

      // Render handle itself the loading
      this.reader.render()
    },
    async loadSound() {
      if (this.$store.state.sound?.length) return // load only if not loaded

      this.$store.commit("startLoading")

      // Load the sound bytes from remote
      await this.$store.dispatch("fetchSound")

      this.$store.commit("stopLoading")
    },
    selectTrack() {
      this.$store.commit("setDrawer", true)
      this.$store.commit("setNavigation", "search")
    },
  },
  watch: {
    async file() {
      await this.loadTrack()
    },
  },
})
</script>
