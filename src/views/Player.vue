<template>
  <v-col>
    <v-row v-show="display">
      <tab-sheet :file="$store.state.file" ref="reader" />
    </v-row>
  </v-col>
</template>

<script>
import Vue from "vue"
import TabSheet from "../components/TabSheet.vue"

export default Vue.extend({
  name: "Player",
  components: { TabSheet },
  data() {
    return {
      loading: false,
      loaded: false,
      reader: null,
    }
  },
  async mounted() {
    this.reader = this.$refs.reader
    
    this.$store.commit('startLoading')
    this.loading = true

    await this.reader.loadSoundsBytes()
    await this.reader.loadScoreBytes()

    this.loading = false
    this.loaded = true
    this.$store.commit('stopLoading')
    
    this.reader.render()
  },
  computed: {
    display() {
      // also display during 'loading' to avoid 
      // 0px width element (cancel alphaTab rendering) 
      return this.loading || this.loaded
    }
  },
})
</script>