<template>
  <div>
    <div>Home</div>
    <TabReader></TabReader>
  </div>
</template>

<script lang="ts">
import Vue from "vue"
import TabReader from "@/components/TabReader.vue"

export default Vue.extend({
  name: "Home",
  components: { TabReader },
})
</script>
