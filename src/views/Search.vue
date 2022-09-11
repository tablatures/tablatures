<template>
  <v-container class="pa-0" fluid>
    <table ref="table" style="display: none" />

    <v-col>
      <v-row v-if="!display">
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
              <tr v-for="item in tracks" :key="item.track.title" @click="rowClick(item)">
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

        <div v-if="!tracks.length" style="text-align: center; font-style:italic; width: 100%" class="pa-3">No track found for this query</div>
      </v-row>

      <v-row v-show="display">
        <tab-sheet :file="file" ref="reader" />
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
      tracks: [],
      loading: false,
      loaded: false,
      file: new Blob(),
      reader: null,
    }
  },
  mounted() {
    this.reader = this.$refs.reader

    this.search()
  },
  watch: {
    "$store.state.query"() {
      // TODO only search if not currently searching (avoid stacking requests)
      this.search()
    }
  },
  computed: {
    display() {
      // also display during 'loading' to avoid 
      // 0px width element (cancel alphaTab rendering) 
      return this.loading || this.loaded
    }
  },
  methods: {
    proxy(source) {
      return fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(source)}`)
      .then(response => {
        if (response.ok) return response.json()
        throw new Error('Error during the proxy')
      })
    },
    extractTable(content) {
      const start_token = '<table class="table table-striped">'
      const end_token =  '</table>'

      const start_index = content.indexOf(start_token) + start_token.length
      const end_index = content.indexOf(end_token)
      return content.substring(0, end_index).substring(start_index);
    },
    extractButton(content) {
      const start_token = '<a class="btn btn-large pull-right" href="'
      const end_token = '" rel="nofollow">Download Tab</a>'

      const start_index = content.indexOf(start_token) + start_token.length
      const end_index = content.indexOf(end_token)
      return content.substring(0, end_index).substring(start_index);
    },
    async search() {
      this.$store.commit('startLoading')

      const source = `https://www.guitarprotabs.net/artist/${this.$store.state.query}`

      const content = await this.proxy(source)
      const table = this.extractTable(content.contents)
      this.$refs.table.innerHTML = table

      this.tracks = []

      for (const row of this.$refs.table.rows) {

        const firstCell = row.cells[0].firstChild
        const trackLink = row.cells[1].firstChild.firstChild
        const groupLink = row.cells[1].children[2]

        const parser = new DOMParser();
        const inner = row.cells[2].innerHTML.split("<br>")[1]

        const parsed = parser.parseFromString(String(inner), "text/html");
        const links = parsed.getElementsByTagName("a")
        const album = links.length ? links[0].innerHTML : "Single"

        const [views, tracks] = row.cells[3].innerHTML.split("<br>")

        this.tracks.push({
          type: firstCell.innerHTML,
          track: {
            href: trackLink?.href,
            title: trackLink?.title,
          },
          group: {
            href: groupLink?.href,
            title: groupLink?.title,
          },
          album: album,
          views: views?.split("# Views ")[1],
          tracks: tracks?.split("# Tracks ")[1]
        })
      }
      
      this.$store.commit('stopLoading')
    },
    async rowClick(e) {
      this.$store.commit('startLoading')
      
      const content = await this.proxy(`https://www.guitarprotabs.net/${e.track.href}`)
      const href = this.extractButton(content.contents)
      const download = await this.proxy(`https://www.guitarprotabs.net/${href}`)

      const encoder = new TextEncoder()
      const encoded = encoder.encode(String(download.contents))
      const blob =  new Blob([encoded])
      this.file = new File([blob], e.track.title)

      this.loading = true

      await this.reader.loadSoundsBytes()
      await this.reader.loadScoreBytes()

      this.loading = false
      this.loaded = true
      this.$store.commit('stopLoading')
      
      this.reader.render()
    }
  }
})
</script>
