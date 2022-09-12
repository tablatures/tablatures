<template>
  <v-container fluid>
    <v-file-input
      prepend-icon="mdi-music-note"
      :clearable="false"
      v-model="file"
      @change="onChange"
      label="tablature file"
      hint=".gp3, .gp4, .gp5, .gpx, .gp, .xml, .cap or .tex"
      :persistent-hint="true"
    />
  </v-container>
</template>

<script>
import Vue from "vue"

export default Vue.extend({
  name: "Import",
  computed: {
    file: {
      get() {
        return this.$store.state.file
      },
      set(file) {
        this.$store.commit("loadFile", file)
        this.$router.push({ name: "Player"})
      }
    }
  },
  methods: {
    async onChange() {
    },
  },
})
</script>
