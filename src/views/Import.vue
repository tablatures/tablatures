<template>
  <v-container fluid>
    <v-col>
      <v-row v-if="!display">
        <v-file-input
          prepend-icon="mdi-music-note"
          :clearable="false"
          v-model="file"
          @change="onChange"
          label="tablature file"
          hint=".gp3, .gp4, .gp5, .gpx, .gp, .xml, .cap or .tex"
          :persistent-hint="true"
        />
      </v-row>

      <v-row v-show="display">
        <tab-sheet :file="file" ref="reader" />
      </v-row>
    </v-col>
  </v-container>
</template>

<script>
import Vue from "vue"
import TabSheet from "../components/TabSheet.vue"

export default Vue.extend({
  name: "Import",
  components: { TabSheet },
  data() {
    return {
      loading: false,
      loaded: false,
      file: new Blob(),
      reader: null,
    }
  },
  mounted() {
    this.reader = this.$refs.reader
  },
  computed: {
    display() {
      // also display during 'loading' to avoid 
      // 0px width element (cancel alphaTab rendering) 
      return this.loading || this.loaded
    }
  },
  methods: {
    async onChange() {
      this.$store.commit('startLoading')
      this.loading = true

      await this.reader.loadSoundsBytes()
      await this.reader.loadScoreBytes()

      this.loading = false
      this.loaded = true
      this.$store.commit('stopLoading')
      
      this.reader.render()
    },
  },
})
</script>
