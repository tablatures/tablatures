<template>
  <div>
    <v-text-field
      prepend-icon="mdi-magnify"
      @keyup.enter="search"
      v-model="query"
      label="track author"
      hint=".gp3, .gp4, .gp5, .gpx, .gp, .xml, .cap or .tex"
      :persistent-hint="true"
    />

    <v-container>
      <v-simple-table style="width: 100%" height="calc(100vh - 250px)" dense>
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
            <tr v-for="(item, i) in list" :key="i" @click="rowClick(item)">
              <td>
                <b>{{ item.track.title }}</b>
              </td>
              <td>{{ item.group.title }}</td>
              <td>{{ item.album }}</td>
              <td>{{ item.views }}</td>
              <td>{{ item.tracks }}</td>
              <td>{{ item.type }}</td>
            </tr>
          </tbody>
        </template>
      </v-simple-table>

      <div v-if="!list.length" style="text-align: center; font-style: italic; width: 100%" class="pa-3">No track found for this query</div>
    </v-container>

    <v-pagination v-model="index" :length="list.length" total-visible="7" />
  </div>
</template>

<script>
import Vue from "vue"

/**
 * @emit update when file selected
 */
export default Vue.extend({
  name: "Search",
  data() {
    return {
      loading: false,
      reader: null,
      list: [],
    }
  },
  computed: {
    query: {
      get() {
        return this.$store.state.query
      },
      set(query) {
        this.$store.commit("searchQuery", query)
      },
    },
    index: {
      get() {
        return this.$store.state.index
      },
      set(value) {
        this.$store.commit("searchIndex", value)
        this.search()
      },
    },
  },
  mounted() {
    this.reader = this.$refs.reader
    this.search()
  },
  methods: {
    async search() {
      // avoid stacking requests
      if (!this.loading) {
        this.loading = true

        const GUITAR_PRO_TABS = 0
        const PREFETCH_NEXT = 2

        try {
          await this.$store.dispatch("fetchList", { source: GUITAR_PRO_TABS, pages: PREFETCH_NEXT })
        } catch (error) {
          this.$store.commit("stopLoading")
          this.$store.commit("displayError", error)
        }

        // update current list with database one
        this.list = this.$store.state.database[this.query]?.[this.index] || []

        this.loading = false
      }
    },
    async rowClick(item) {
      try {
        await this.$store.dispatch("fetchTrack", {
          source: item.source,
          target: item.track,
        })

        this.$emit("update")
      } catch (error) {
        this.$store.commit("stopLoading")
        this.$store.commit("displayError", error)
      }
    },
  },
})
</script>
<style>
.centered-input input {
  text-align: center;
}
</style>
