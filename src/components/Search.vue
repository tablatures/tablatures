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
    </v-container>

    <v-pagination v-model="index" :length="length" total-visible="7" />
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
      length: 0,
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
      this.$store.commit("startLoading")
      try {
        // avoid stacking requests
        if (!this.loading) {
          this.loading = true

          const GUITAR_PRO_TABS = 0
          const PREFETCH_NEXT = 2

          await this.$store.dispatch("fetchList", { source: GUITAR_PRO_TABS, pages: PREFETCH_NEXT })

          // update current list with database one
          const current = this.$store.state.database[this.query]?.[this.index] || {}

          this.length = Object.keys(this.$store.state.database[this.query]).length
          this.list = [...Object.values(current)]

          this.loading = false
        }
      } catch (error) {
        console.error(error)
        this.$store.commit("displayError", error)
      }

      this.$store.commit("stopLoading")
    },
    async rowClick(item) {
      this.$store.commit("startLoading")
      try {
        this.$emit("update")
        // Convert Item to serializable object
        await this.$store.dispatch("fetchTrack", { source: item.source, target: item.track })
      } catch (error) {
        console.error(error)
        this.$store.commit("displayError", error)
      }
      this.$store.commit("stopLoading")
    },
  },
})
</script>
<style>
.centered-input input {
  text-align: center;
}
</style>
