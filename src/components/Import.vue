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

      // Convert File object to serializable object
      const name = file.name
      const data = await file.text()
      this.$store.commit("loadFile", { name, data })
    },
  },
})
</script>
