<template>
  <v-file-input
    prepend-icon="mdi-music-note"
    :clearable="false"
    @change="update"
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
  methods: {
    async update(file) {
      this.$emit("update")
      this.$store.commit("loadFile", await file.text())
    },
  },
})
</script>
