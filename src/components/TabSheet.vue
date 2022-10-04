<template>
  <v-container fluid>
    <div v-show="ready" class="player-bar" style="width: 100%">
      <v-system-bar dark color="primary"> {{ title }} </v-system-bar>
      <v-toolbar dense flat elevation="3">
        <v-btn icon small class="pa-5 px-sm-6" @click="play" :color="playing ? 'primary' : 'grey'">
          <v-icon> {{ playing ? "mdi-pause" : "mdi-play" }} </v-icon>
        </v-btn>
        <v-btn icon small class="pa-5 px-sm-6" @click="looping = !looping" :color="looping ? 'primary' : 'grey'">
          <v-icon> mdi-sync </v-icon>
        </v-btn>
        <v-btn icon small class="pa-5 px-sm-6" @click="metronome = !metronome" :color="metronome ? 'primary' : 'grey'">
          <v-icon> mdi-metronome </v-icon>
        </v-btn>

        <v-menu offset-x :close-on-content-click="false">
          <template v-slot:activator="{ on, attrs }">
            <v-btn class="ma-sm-0 pa-sm-2" style="margin: -10px" text color="grey" v-bind="attrs" v-on="on">
              <v-icon left class="d-none d-sm-flex"> mdi-timelapse </v-icon>
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
            <v-btn class="ma-sm-0 pa-sm-2" style="margin: -10px" text color="grey" v-bind="attrs" v-on="on">
              <v-icon left class="d-none d-sm-flex"> mdi-volume-high </v-icon>
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

        <v-btn icon small class="pa-5 px-sm-6" color="grey" @click="horizontal = !horizontal">
          <v-icon> {{ horizontal ? "mdi-format-horizontal-align-right" : "mdi-page-layout-body" }} </v-icon>
        </v-btn>

        <v-btn icon small class="pa-5 px-sm-6" color="grey" :href="fileURL" :download="file?.name">
          <v-icon> mdi-download</v-icon>
        </v-btn>

        <v-btn icon small class="pa-5 px-sm-6" color="grey" @click="print">
          <v-icon> mdi-printer </v-icon>
        </v-btn>
      </v-toolbar>
    </div>

    <v-sheet elevation="5" height="100%" width="100%">
      <div class="at-wrap">
        <div class="at-content">
          <div class="at-sidebar" />
          <div class="at-viewport">
            <div class="at-main" />
          </div>
        </div>
        <div class="at-controls" />
      </div>
      <div id="alphaTabStyle" />
    </v-sheet>
  </v-container>
</template>

<script>
import Vue from "vue"

/**
 * @prop {object} file track `{name: string, data: Uint8Array}`
 * @prop {UInt8Array} sound bytes `Uni`
 */
export default Vue.extend({
  name: "TabSheet",
  props: {
    file: { default: undefined },
    sound: { default: undefined },
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
  beforeDestroy() {
    if (this.playing) this.play() // pause the currently playing track
    this.api.destroy() // clear the alphaTab controls
    this.api = undefined // clear object
  },
  computed: {
    fileURL() {
      if (!this.file?.data) return "undefined"

      try {
        const tempBlob = new Blob([this.file.data])
        const tempFile = new File([tempBlob], this.file.name)
        return URL.createObjectURL(tempFile)
      } catch {
        return "undefined"
      }
    },
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
    },
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
      if (!this.file) return // avoid re-rendering when empty track

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
    clearReset() {
      this.api.destroy() // clear context
      this.api = undefined // reset api
      this.loadApi() // reset context
    },
    pauseUpdate(fun) {
      setTimeout(() => {
        const wasPlaying = this.playing

        this.$store.commit("startLoading")
        if (wasPlaying) this.play() // pause to avoid sound stuttering

        setTimeout(async () => {
          fun()

          await this.render()

          if (wasPlaying) this.play() // restard the track playback
          this.$store.commit("stopLoading")
        }, 100)
      }, 100)
    },
    getContainer() {
      const wrapper = document.querySelector(".at-wrap")

      if (wrapper === null) return [undefined, undefined, undefined]

      const main = wrapper.querySelector(".at-main")
      const viewport = wrapper.querySelector(".at-viewport")
      return [wrapper, main, viewport]
    },
    loadApi() {
      // Load container
      const [wrapper, main, viewport] = this.getContainer()

      // Load settings and fonts
      const settings = new alphaTab.Settings()
      settings.core.engine = "html5"
      settings.core.logLevel = 2
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

      // Add loading listeners
      this.api.renderStarted.on(() => this.$store.commit("startLoading"))
      this.api.renderFinished.on(() => this.$store.commit("stopLoading"))
    },
    loadSoundsBytes() {
      try {
        if (!this.sound?.length) throw new Error("No sound can be loaded")

        this.api.loadSoundFont(this.sound)
      } catch (error) {
        console.error(error)
        this.$store.commit("displayError", error)
      }
    },
    loadScoreBytes() {
      try {
        if (!this.file?.data) throw new Error("No track can be loaded")

        const raw = String(this.file.data)
        const encoded = new Uint8Array(raw.length)

        for (let i = 0; i < raw.length; i++) {
          encoded[i] = raw.charCodeAt(i)
        }

        this.api.load(encoded)
      } catch (error) {
        console.error(error)
        this.$store.commit("displayError", error)
      }
    },
    render() {
      try {
        this.api.updateSettings()
        this.api.render()
      } catch (error) {
        console.error(error)
        this.$store.commit("displayError", error)
      }
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
