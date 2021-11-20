<template>
  <div id="app">
    <h1>AlphaTab - problem loading sound font</h1>
    <div>
      <v-btn v-on:click="loadSoundsBytes">loadSoundsBytes = {{ soundLoaded }}</v-btn>
      <v-btn v-on:click="loadScoreBytes">loadScoreBytes = {{ scoreLoaded }}</v-btn>
      <v-btn v-on:click="play">{{ playing ? "pause" : "play" }}</v-btn>
      <v-btn v-on:click="print">print</v-btn>
    </div>
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
  </div>
</template>

<script>
import Vue from "vue"
const proxy = "" //"https://cors-anywhere.herokuapp.com/"
import { AlphaTabApi, Settings, model } from "@coderline/alphatab"

export default Vue.extend({
  name: "Test",
  data() {
    return {
      api: undefined,
      soundLoaded: "false",
      scoreLoaded: "false",
      playing: false,
    }
  },
  methods: {
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
      const settings = new Settings()
      settings.core.engine = "html5"
      settings.core.logLevel = 0 // 1
      settings.core.useWorkers = false

      settings.player.enablePlayer = true
      settings.player.enableCursor = true

      // Tryed using the api loader
      // settings.player.soundFont = "https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/soundfont/sonivox.sf2"

      if (viewport === undefined) return
      settings.player.scrollElement = viewport

      // Initialize api
      if (main === undefined) return
      this.api = new AlphaTabApi(main, settings)
      this.api.metronomeVolume = 1
      this.api.playbackSpeed = 0.5
      console.log(this.api)
    },
    loadScoreBytes() {
      this.scoreLoaded = "loading..."

      return new Promise((resolve, reject) => {
        const url = proxy + "https://alphatab.net/files/canon.gp"
        const request = new XMLHttpRequest()
        request.open("GET", url, true)
        request.responseType = "arraybuffer"
        request.onload = () => {
          const buffer = new Uint8Array(request.response)

          this.scoreLoaded = "true"
          console.log(buffer)
          return this.api.load(buffer) ? resolve() : reject()
        }
        request.send()
      })
    },
    loadSoundsBytes() {
      this.soundLoaded = "loading..."

      return new Promise((resolve, reject) => {
        const url = proxy + "https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.2.1/dist/soundfont/sonivox.sf2"
        const request = new XMLHttpRequest()
        request.open("GET", url, true)
        request.responseType = "arraybuffer"
        request.onload = () => {
          const sonivox = new Uint8Array(request.response)

          // Tryed encoding before passing the sf
          // const encoder = new TextEncoder()
          // const buffer = new Uint8Array(encoder.encode(sonivox))

          this.soundLoaded = "true"
          console.log(sonivox)
          // this.api.loadSoundFont(sonivox)

          return this.api.loadSoundFont("https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.2.1/dist/soundfont/sonivox.sf2") ? resolve() : reject()
        }
        request.send()
      })
    },
    play() {
      console.log("Ready? " + this.api.isReadyForPlayback)
      this.api.playPause()
      this.playing = this.api.player.playerState
    },
    print() {
      this.api.print()
    },
  },
  mounted() {
    console.log("Mounted")
    this.loadApi()
  },
})
</script>
