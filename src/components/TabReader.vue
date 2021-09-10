<template>
  <v-container style="height: 100%; overflow: hidden">
    <v-file-input prepend-icon="mdi-music-note" :clearable="false" v-model="file" @change="onChange"></v-file-input>
    <v-sheet elevation="0" style="height: 100%; overflow: auto">
      <Loading v-if="loading" :status="STATUS" :completion="completion" :tasks="TASKS_NUMBER"></Loading>
      <div class="at-wrap">
        <div class="at-content">
          <div class="at-sidebar">Track selector will go here</div>
          <div class="at-viewport">
            <div class="at-main"></div>
          </div>
          <div id="alphaTabStyle"></div>
        </div>
        <div class="at-controls">Player controls will go here</div>
      </div>
    </v-sheet>
  </v-container>
</template>

<script lang="ts">
import Vue from "vue"
import Loading from "@/components/Loading.vue"
import { midi, synth, AlphaTabApi, Settings } from "@coderline/alphatab"
import sonivox from "!!raw-loader!@/assets/soundfont/sonivox.sf2"

// const settings = new alphaTab.Settings()
//const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fileData), settings)

const DELAY = 200

const LOADING_BYTES = 1
const LOADING_SCORE = 2
const LOADING_SVGS = 3
const TASKS_NUMBER = 3

const STATUS = [
  { id: LOADING_BYTES, text: "Loading bytes..." },
  { id: LOADING_SCORE, text: "Loading score..." },
  { id: LOADING_SVGS, text: "Loadings svgs..." },
]

export default Vue.extend({
  name: "TabReader",
  components: { Loading },
  data(): any {
    return {
      file: new Blob(),
      bytes: new Uint8Array(),
      api: undefined as any,
      loading: false,
      completion: LOADING_BYTES,
      STATUS: STATUS,
      LOADING_BYTES: LOADING_BYTES,
      LOADING_SCORE: LOADING_SCORE,
      LOADING_SVGS: LOADING_SVGS,
      TASKS_NUMBER: TASKS_NUMBER,
    }
  },
  mounted() {
    console.log("TESSSST")
    this.loadApi()
  },
  methods: {
    async onChange(): Promise<void> {
      this.loading = true
      await this.updateStatus(LOADING_BYTES)
      await this.loadBytes()

      await this.updateStatus(LOADING_SCORE)
      await this.loadScore()

      await this.updateStatus(LOADING_SVGS)
      this.svgs = await this.generateSVG()
      this.loading = false

      // this.generateMIDI()
      // await this.loadSounds()
      // this.playMIDI()
    },
    getContainer(): HTMLElement | undefined {
      const wrapper = document.querySelector(".at-wrap")
      if (wrapper === null) return undefined
      const main = wrapper.querySelector(".at-main")
      if (main === null) return undefined
      return main as HTMLElement
    },
    loadApi(): void {
      // Load settings and fonts
      const settings = new Settings()

      // Load container
      const container = this.getContainer()
      if (container === undefined) return

      // Initialize api
      this.api = new AlphaTabApi(container, settings)
    },
    loadBytes(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const reader: FileReader = new FileReader()
        reader.readAsArrayBuffer(this.file)
        reader.onloadend = (e: ProgressEvent<FileReader>) => {
          if (e.target === null) return reject()
          const target: any = e.target

          if (e.target.readyState == FileReader.DONE) {
            const arrayBuffer: any = e.target.result
            this.bytes = new Uint8Array(arrayBuffer)
            return resolve()
          }
        }
      })
    },
    loadScore(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        return this.api.load(this.bytes) ? resolve() : reject()
      })
    },
    generateSVG(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        console.log(this.api)
        // this.api.renderScore(this.api.score, [0])
        // look at : https://docs.alphatab.net/develop/reference/api/
        this.api.renderTracks([this.api.score.tracks[0]])
        this.api.print()
        //this.api.createCanvasElement()
        resolve()
      })
    },
    generateMIDI(): void {
      // TODO: https://www.alphatab.net/docs/guides/lowlevel-apis#generating-midi-files-via-midifilegenerator
      this.audio = new midi.MidiFile()
      const handler = new midi.AlphaSynthMidiFileHandler(this.audio)
      const generator = new midi.MidiFileGenerator(this.score, null, handler)

      generator.generate()
    },
    loadSounds(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const encoder = new TextEncoder()
        return this.api.loadSoundFont(new Uint8Array(encoder.encode(sonivox))) ? resolve() : reject()
      })
    },
    playMIDI(): void {
      console.log(synth)
      /*
      const player = new synth.AlphaSynthWebWorkerApi()
      player.loadSoundFont(this.sounds, false)
      player.loadMidiFile(this.audio)
      player.play()*/
    },
    async updateStatus(status: number): Promise<void> {
      this.completion = status
      await this.delay(DELAY)
    },
    delay(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms))
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
