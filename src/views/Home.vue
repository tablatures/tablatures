<template>
  <v-container style="height: 100%">
    <TabReader></TabReader>
  </v-container>
</template>

<script lang="ts">
import Vue from "vue"
import TabReader from "@/components/TabReader.vue"

export default Vue.extend({
  name: "Home",
  components: { TabReader },
})
</script>
