<template>
  <v-file-input
    prepend-icon="mdi-music-note"
    :clearable="false"
    v-model="file"
    label="tablature file"
    hint=".gp3, .gp4, .gp5, .gpx, .gp, .xml, .cap or .tex"
    :persistent-hint="true"
  />
</template>

<script>
import Vue from "vue"

/**
 * @emit update when file selected
 */
export default Vue.extend({
  name: "Import",
  computed: {
    file: {
      get() {
        return this.$store.state.file
      },
      set(file) {
        this.$store.commit("loadFile", file)
        this.$emit("update")
      },
    },
  },
})
</script>
