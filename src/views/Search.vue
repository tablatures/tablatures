<template>
  <v-container class="pa-0" fluid>
    <v-col>
      <v-row align="center" justify="center" class="d-inline d-sm-flex">
        <v-card style="text-align: center" elevation="1" class="mb-3 mx-2 px-3">
          <b>search for artist</b><br/>
          <v-text-field dense solo flat hide-details class="centered-input" v-model="query" label="research query" append-outer-icon="mdi-close" @click:append-outer="query = ''" prepend-icon="mdi-magnify" @click:prepend="search" />
        </v-card>
        <v-card style="text-align: center" elevation="1" class="mb-3 mx-2 px-3">
          <b>number of pages</b><br/>
          <v-text-field dense solo flat hide-details class="centered-input" v-model="pages" type="number" label="number of pages" append-outer-icon="mdi-plus" @click:append-outer="pages++" prepend-icon="mdi-minus" @click:prepend="pages--" />
        </v-card>
        <v-card style="stext-align: center" elevation="1" class="mb-3 mx-2 px-3">
          <b>start from index</b><br/>
          <v-text-field dense solo flat hide-details class="centered-input" v-model="index" type="number" label="index of start page" append-outer-icon="mdi-plus" @click:append-outer="index++" prepend-icon="mdi-minus" @click:prepend="index--" />
        </v-card>
      </v-row>
      <v-row class="my-0">
        <v-simple-table style="width:100%">
          <template v-slot:default>
            <thead>
              <tr>
                <th class="text-left">TRACK</th>
                <th class="text-left">GROUP</th>
                <th class="text-left">ALBUM</th>
                <th class="text-left">VIEWS</th>
                <th class="text-left">TRACKS</th>
                <th class="text-left">TYPE</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in $store.state.list" :key="index" @click="rowClick(item)">
                <td><b>{{ item.track.title }}</b></td>
                <td>{{ item.group.title }}</td>
                <td>{{ item.album }}</td>
                <td>{{ item.views }}</td>
                <td>{{ item.tracks }}</td>
                <td>{{ item.type }}</td>
              </tr>
            </tbody>
          </template>
        </v-simple-table>

        <div v-if="!$store.state.list.length" style="text-align: center; font-style:italic; width: 100%" class="pa-3">No track found for this query</div>
      </v-row>
    </v-col>
  </v-container>
</template>

<script>
import Vue from "vue"
import TabSheet from "../components/TabSheet.vue"

export default Vue.extend({
  name: "Search",
  components: { TabSheet },
  data() {
    return {
      sindex: 1,
      spages: 3,
      loading: false,
      loaded: false,
      reader: null,
    }
  },
  computed: {
    query: {
      get() { return this.$store.state.query },
      set(query) { this.$store.commit("searchQuery", query) }
    },
    index: {
      get() { return this.sindex },
      set(value) { this.sindex = Math.min(Math.max(value, 1), 10) }
    },
    pages: {
      get() { return this.spages },
      set(value) { this.spages = Math.min(Math.max(value, 1), 3) }
    }
  },
  mounted() {
    this.reader = this.$refs.reader
    this.search()
  },
  watch: {
    "$store.state.query"() {
        this.search()
    },
    pages() {
      this.search()
    },
    index() {
      this.search()
    }
  },
  methods: {
    search() {
      // avoid stacking requests
      if (!this.$store.state.loading) {
        this.$store.commit("clearList")
        this.$store.dispatch("fetchList", { source: 0, pages: this.spages, index: this.sindex })
      }
    },
    async rowClick(item) {
      await this.$store.dispatch("fetchTrack", {
        source: item.source,
        target: item.track
      })

      this.$router.push({ name: "Player"})
    }
  }
})
</script>
<style>
.centered-input input {
  text-align: center;
}
</style>