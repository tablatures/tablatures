<template>
  <v-container :fluid="fullscreen">
    <v-system-bar dark color="primary"> {{ title }} </v-system-bar>
    <v-toolbar dense flat elevation="3">
      <v-btn icon @click="play" :color="playing ? 'blue' : 'grey'">
        <v-icon>{{ playing ? "mdi-pause" : "mdi-play" }}</v-icon>
      </v-btn>
      <v-btn icon @click="looping = !looping" :color="looping ? 'blue' : 'grey'">
        <v-icon>mdi-sync</v-icon>
      </v-btn>
      <v-btn icon @click="metronome = !metronome" :color="metronome ? 'blue' : 'grey'">
        <v-icon>mdi-metronome</v-icon>
      </v-btn>

      <v-menu offset-x :close-on-content-click="false">
        <template v-slot:activator="{ on, attrs }">
          <v-btn text color="grey" v-bind="attrs" v-on="on">
            <v-icon left> mdi-timelapse </v-icon>
            {{ speed }}%
          </v-btn>
        </template>
        <v-card width="200px">
          <v-slider v-model="speed" :max="CONSTS.TEMPO.MAX" :min="CONSTS.TEMPO.MIN" :step="CONSTS.TEMPO.STEP" hide-details style="overflow: hidden" class="px-2">
            <template v-slot:prepend>
              <v-icon @click="speed -= CONSTS.TEMPO.STEP"> mdi-minus </v-icon>
            </template>
            <template v-slot:append>
              <v-icon @click="speed += CONSTS.TEMPO.STEP"> mdi-plus </v-icon>
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
          <v-slider v-model="volume" :max="CONSTS.VOLUME.MAX" :min="CONSTS.VOLUME.MIN" :step="CONSTS.VOLUME.STEP" hide-details style="overflow: hidden" class="px-2">
            <template v-slot:prepend>
              <v-icon @click="volume -= CONSTS.VOLUME.STEP"> mdi-minus </v-icon>
            </template>
            <template v-slot:append>
              <v-icon @click="volume += CONSTS.VOLUME.STEP"> mdi-plus </v-icon>
            </template>
          </v-slider>
        </v-card>
      </v-menu>

      <v-spacer></v-spacer>

      <v-menu offset-y>
        <template v-slot:activator="{ on, attrs }">
          <v-btn icon v-bind="attrs" v-on="on">
            <v-icon>{{ layouts[layout].icon }}</v-icon>
          </v-btn>
        </template>
        <v-list dense>
          <v-list-item-group v-model="layout" color="primary">
            <v-list-item v-for="(item, i) in layouts" :key="i">
              <v-list-item-icon>
                <v-icon>{{ item.icon }}</v-icon>
              </v-list-item-icon>
              <v-list-item-content>
                <v-list-item-title> {{ item.title }}</v-list-item-title>
              </v-list-item-content>
            </v-list-item>
          </v-list-item-group>
        </v-list>
      </v-menu>

      <v-btn icon @click="fullscreen = !fullscreen">
        <v-icon>{{ fullscreen ? "mdi-format-horizontal-align-center" : "mdi-arrow-expand-horizontal" }}</v-icon>
      </v-btn>

      <v-btn icon @click="print">
        <v-icon>mdi-printer</v-icon>
      </v-btn>
    </v-toolbar>

    <v-sheet elevation="10" style="height: 600px; overflow: auto">
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

<script lang="ts">
import Vue from "vue"
import { AlphaTabApi, Settings } from "@coderline/alphatab"
import sonivox from "!!raw-loader!@/assets/soundfont/sonivox.sf2"

const CONSTS = {
  TEMPO: {
    MAX: 300,
    MIN: 20,
    STEP: 10,
  },
  VOLUME: {
    MAX: 100,
    MIN: 0,
    STEP: 1,
  },
  LOG: 0,
}

export default Vue.extend({
  name: "TabReader",
  props: {
    file: { type: Blob, default: new Blob() },
  },
  data(): any {
    return {
      CONSTS: CONSTS,
      api: undefined as any,
      speed: 100,
      metronome: false,
      volume: 100,
      looping: false,
      fullscreen: false,
      playing: false,
      layout: 0,
      layouts: [
        { title: "Page", icon: "mdi-page-layout-body" },
        { title: "Horizontal", icon: "mdi-format-horizontal-align-right" },
      ],
    }
  },
  mounted() {
    this.loadApi()
  },
  computed: {
    title(): string {
      if (this.api == null) return "<api not loaded>"
      if (this.api.score == null) return "<score not loaded>"
      const title = this.api.score.title
      const artist = this.api.score.artist
      return `${title || "???"} by ${artist || "???"}`
    },
  },
  watch: {
    layout() {
      this.api.settings.display.layoutMode = this.layout
      this.api.updateSettings()
      this.api.render()
    },
    metronome() {
      this.api.metronomeVolume = this.metronome === 1
    },
    volume() {
      this.api.masterVolume = this.volume
    },
    looping() {
      this.api.isLooping = this.looping
    },
  },
  methods: {
    getContainer(): Array<HTMLElement | undefined> {
      const wrapper = document.querySelector(".at-wrap")
      if (wrapper === null) return [undefined, undefined, undefined]
      const main = wrapper.querySelector(".at-main")
      const viewport = wrapper.querySelector(".at-viewport")
      return [wrapper as HTMLElement, main as HTMLElement, viewport as HTMLElement]
    },
    loadApi(): void {
      // Load container
      const [wrapper, main, viewport] = this.getContainer()

      // Load settings and fonts
      const settings = new Settings()
      settings.core.engine = "html5"
      settings.core.logLevel = this.CONSTS.LOG
      settings.core.useWorkers = true

      settings.player.enablePlayer = true
      settings.player.enableCursor = true

      if (viewport === undefined) return
      settings.player.scrollElement = viewport

      // Initialize api
      if (main === undefined) return
      this.api = new AlphaTabApi(main, settings)
      this.api.metronomeVolume = 1
      this.api.playbackSpeed = 0.5
    },

    loadScoreBytes(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const reader: FileReader = new FileReader()
        reader.readAsArrayBuffer(this.file)
        reader.onloadend = (e: ProgressEvent<FileReader>) => {
          if (e.target === null) return reject()
          const target: any = e.target

          if (e.target.readyState == FileReader.DONE) {
            const arrayBuffer: any = e.target.result
            return this.api.load(new Uint8Array(arrayBuffer)) ? resolve() : reject()
          }
        }
      })
    },
    loadSoundsBytes(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const encoder = new TextEncoder()
        const buffer = new Uint8Array(encoder.encode(sonivox))
        return this.api.loadSoundFont(buffer, true) ? resolve() : reject()
      })
    },
    generateSVG(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        console.log(this.api)
        this.api.renderer.renderFinished.on((e: any) => {
          resolve()
        })

        // look at : https://docs.alphatab.net/develop/reference/api/
        this.api.renderTracks([this.api.score.tracks[0]])
      })
    },
    play(): void {
      console.log("Ready? " + this.api.isReadyForPlayback)
      this.playing = this.api.player.playerState
      this.api.player.play()
    },
    print(): void {
      this.api.print()
    },
  },
})
</script>
<style lang="scss">
.at-surface * {
  cursor: default;
  vertical-align: top;
  overflow: visible;
}
.at {
  font-family: "alphaTab";
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  line-height: 1;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size: 34px;
  overflow: visible !important;
}
</style>
