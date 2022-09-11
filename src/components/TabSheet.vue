<template>
  <v-container fluid>
    <div v-show="ready" class="player-bar">
      <v-system-bar dark color="primary"> {{ title }} </v-system-bar>
      <v-toolbar dense flat elevation="3">
        <v-btn icon @click="play" :color="playing ? 'blue' : 'grey'">
          <v-icon> {{ playing ? "mdi-pause" : "mdi-play" }} </v-icon>
        </v-btn>
        <v-btn icon @click="looping = !looping" :color="looping ? 'blue' : 'grey'">
          <v-icon> mdi-sync </v-icon>
        </v-btn>
        <v-btn icon @click="metronome = !metronome" :color="metronome ? 'blue' : 'grey'">
          <v-icon> mdi-metronome </v-icon>
        </v-btn>

        <v-menu offset-x :close-on-content-click="false">
          <template v-slot:activator="{ on, attrs }">
            <v-btn text color="grey" v-bind="attrs" v-on="on">
              <v-icon left> mdi-timelapse </v-icon>
              {{ speed }}%
            </v-btn>
          </template>
          <v-card width="200px">
            <v-slider v-model="speed" min="20" max="200" step="10" hide-details style="overflow: hidden" class="px-2">
              <template v-slot:prepend>
                <v-icon @click="speed -= 10"> mdi-minus </v-icon>
              </template>
              <template v-slot:append>
                <v-icon @click="speed += 10"> mdi-plus </v-icon>
              </template>
            </v-slider>
          </v-card>
        </v-menu>

        <v-menu offset-x :close-on-content-click="false">
          <template v-slot:activator="{ on, attrs }">
            <v-btn text color="grey" v-bind="attrs" v-on="on">
              <v-icon left> mdi-volume-high </v-icon>
              {{ volume }}%
            </v-btn>
          </template>
          <v-card width="200px">
            <v-slider v-model="volume" min="0" max="200" step="1" hide-details style="overflow: hidden" class="px-2">
              <template v-slot:prepend>
                <v-icon @click="volume -= 10"> mdi-minus </v-icon>
              </template>
              <template v-slot:append>
                <v-icon @click="volume += 10"> mdi-plus </v-icon>
              </template>
            </v-slider>
          </v-card>
        </v-menu>

        <v-spacer></v-spacer>
        
        <v-btn icon @click="horizontal = !horizontal">
          <v-icon> {{ horizontal ? "mdi-format-horizontal-align-right" : "mdi-page-layout-body" }} </v-icon>
        </v-btn>

        <v-btn icon @click="print">
          <v-icon> mdi-printer </v-icon>
        </v-btn>
      </v-toolbar>
    </div>
    
    <v-sheet elevation="10" height="100%" style="overflow: auto">
      <div class="at-wrap">
        <div class="at-content">
          <div class="at-sidebar"></div>
          <div class="at-viewport">
            <div class="at-main"></div>
          </div>
        </div>
        <div class="at-controls"></div>
      </div>
      <div id="alphaTabStyle"></div>
    </v-sheet>
  </v-container>
</template>

 <script>
import Vue from "vue"

export default Vue.extend({
  name: "TabSheet",
  props: {
    file: { type: Blob, default: new Blob() },
  },
  data() {
    return {
      api: undefined,
      speed: 100,
      metronome: false,
      volume: 100,
      looping: false,
      playing: false,
      horizontal: false,
    }
  },
  mounted() {
    this.loadApi()
  },
  computed: {
    title() {
      if (this.api == null) return "<api not loaded>"
      if (this.api.score == null) return "<score not loaded>"
      const title = this.api.score.title
      const artist = this.api.score.artist
      return `${title || "???"} by ${artist || "???"}`
    },
    ready() {
      if (!this.api) return false
      return this.api.isReadyForPlayback
    }
  },
  watch: {
    horizontal() {
      this.pauseUpdate(() => {
        const layout = this.horizontal ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page 
        this.api.settings.display.layoutMode = layout
      })
    },
    metronome() {
      this.api.metronomeVolume = this.metronome
      this.api.updateSettings()
    },
    volume() {
      this.api.masterVolume = this.volume / 100
      this.api.updateSettings()
    },
    speed() {
      this.api.playbackSpeed = this.speed / 100
      this.api.updateSettings()
    },
    looping() {
      this.api.isLooping = this.looping
      this.api.updateSettings()
    },
    "$vuetify.theme.dark"(dark) {
      this.pauseUpdate(() => {
        const white = new alphaTab.model.Color(255, 255, 255, 0.8)
        const black = new alphaTab.model.Color(0, 0, 0, 0.8)

        const selected = dark ? white : black
        
        this.api.settings.display.resources.staffLineColor = selected
        this.api.settings.display.resources.barSeparatorColor = selected
        this.api.settings.display.resources.barNumberColor = selected
        this.api.settings.display.resources.mainGlyphColor = selected
        this.api.settings.display.resources.secondaryGlyphColor = selected
        this.api.settings.display.resources.scoreInfoColor = selected
      })
    },
  },
  methods: {
    pauseUpdate(fun) {
      setTimeout(() => {
        const wasPlaying = this.playing

        this.$store.commit('startLoading')
        if (wasPlaying) this.play() // pause to avoid sound stuttering

        setTimeout(() => {
          fun()

          this.render()

          if (wasPlaying) this.play() // restard the track playback
          this.$store.commit('stopLoading')
        }, 100)
      }, 100)
    },
    getContainer() {
      const wrapper = document.querySelector(".at-wrap")

      if (wrapper === null) return [undefined, undefined, undefined]

      const main = wrapper.querySelector(".at-main")
      const viewport = wrapper.querySelector(".at-viewport")
      return [wrapper , main , viewport]
    },
    loadApi() {
      // Load container
      const [wrapper, main, viewport] = this.getContainer()

      // Load settings and fonts
      const settings = new alphaTab.Settings()
      settings.core.engine = "html5"
      settings.core.logLevel = 0
      settings.core.useWorkers = true

      settings.player.enablePlayer = true
      settings.player.enableCursor = true
      
      if (viewport === undefined) return
      settings.player.scrollElement = viewport

      // Initialize api
      if (main === undefined) return
      this.api = new alphaTab.AlphaTabApi(main, settings)
      this.api.metronomeVolume = this.metronome
      this.api.playbackSpeed = this.speed / 100
      this.api.masterVolume = this.volume / 100

      // Update layout
      this.api.settings.display.layoutMode = alphaTab.LayoutMode.Page 
      this.api.updateSettings()
    },
    render() {
      this.api.updateSettings()
      this.api.render()
    },
    loadScoreBytes() {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.readAsArrayBuffer(this.file)
        reader.onloadend = (e) => {
          if (e.target === null) return reject()
          const target = e.target

          if (target.readyState == FileReader.DONE) {
            const arrayBuffer = new Uint8Array(target.result)
            return this.api.load(arrayBuffer) ? resolve() : reject()
          }
        }
      })
    },
    loadSoundsBytes(){
      return new Promise((resolve, reject) => {
        const url = "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.2.1/dist/soundfont/sonivox.sf2"
        const request = new XMLHttpRequest()
        request.open("GET", url, true)
        request.responseType = "arraybuffer"
        request.onload = () => {
          const sonivox = new Uint8Array(request.response)
          this.soundLoaded = "true"
          return this.api.loadSoundFont(sonivox) ? resolve() : reject()
        }
        request.send()
      })
    },
    play() {
      this.playing = !this.playing
      this.api.playPause()
    },
    print() {
      this.api.print()
    },
  },
})
</script>
<style lang="scss">
.player-bar {
  position: sticky;
  top: 0px;
  background-color: white;
  z-index: 9999;
}
</style>
