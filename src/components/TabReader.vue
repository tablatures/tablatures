<template>
  <v-container style="height: 100%; overflow: hidden">
    <v-file-input prepend-icon="mdi-music-note" :clearable="false" v-model="file" @change="onChange"></v-file-input>
    <v-sheet elevation="0" style="height: 100%; overflow: auto">
      <Loading v-if="loading" :status="STATUS" :completion="completion" :tasks="TASKS_NUMBER"></Loading>
      <div v-else v-for="(svg, index) in svgs" :key="index">
        <div v-html="svg"></div>
      </div>
    </v-sheet>
  </v-container>
</template>

<script lang="ts">
import Vue from "vue"
import Loading from "@/components/Loading.vue"
import { importer, rendering, midi, synth, Settings } from "@coderline/alphatab"
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
      sounds: new Uint8Array(),
      score: null as any,
      audio: null as any,
      svgs: [] as Array<any>,
      loading: false,
      completion: LOADING_BYTES,
      STATUS: STATUS,
      LOADING_BYTES: LOADING_BYTES,
      LOADING_SCORE: LOADING_SCORE,
      LOADING_SVGS: LOADING_SVGS,
      TASKS_NUMBER: TASKS_NUMBER,
    }
  },
  methods: {
    async onChange(e: Blob): Promise<void> {
      this.loading = true
      await this.updateStatus(LOADING_BYTES)
      this.bytes = await this.loadBytes(e)

      await this.updateStatus(LOADING_SCORE)
      this.score = await this.loadScore()

      await this.updateStatus(LOADING_SVGS)
      this.svgs = await this.generateSVG()
      this.loading = false

      console.log(this.score)
      this.generateMIDI()
      console.log(this.audio)
      this.sounds = await this.loadSounds()
      console.log(this.sounds)
      this.playMIDI()
    },
    loadBytes(e: Blob): Promise<Uint8Array> {
      return new Promise<Uint8Array>((resolve, reject) => {
        const reader: FileReader = new FileReader()
        reader.readAsArrayBuffer(e)

        reader.onloadend = function (e: ProgressEvent<FileReader>): void {
          if (e.target === null) return reject()
          const target: any = e.target

          if (target.readyState === null) return reject()
          const state: number = target.readyState

          if (e.target.readyState == FileReader.DONE) {
            const arrayBuffer: any = e.target.result
            return resolve(new Uint8Array(arrayBuffer))
          }
        }
      })
    },
    loadScore(): Promise<any> {
      return new Promise<any>((resolve, reject) => {
        return resolve(importer.ScoreLoader.loadScoreFromBytes(this.bytes))
      })
    },
    generateSVG(): Promise<Array<string>> {
      return new Promise<Array<string>>((resolve, reject) => {
        const svgs: Array<string> = []
        const renderer = new rendering.ScoreRenderer(new Settings())
        renderer.width = 1200
        renderer.settings.core.engine = "svg"

        //renderer.preRender.on((isResize: any) => {})

        renderer.partialRenderFinished.on((r: any) => {
          svgs.push(r.renderResult)
        })

        renderer.renderFinished.on((r: any) => {
          svgs.pop()
          return resolve(svgs)
        })

        // 4. Fire off rendering
        renderer.renderScore(this.score, [0])
      })
    },
    generateMIDI(): void {
      // TODO: https://www.alphatab.net/docs/guides/lowlevel-apis#generating-midi-files-via-midifilegenerator
      this.audio = new midi.MidiFile()
      const handler = new midi.AlphaSynthMidiFileHandler(this.audio)
      const generator = new midi.MidiFileGenerator(this.score, null, handler)

      generator.generate()
    },
    loadSounds(): Promise<Uint8Array> {
      return new Promise<Uint8Array>((resolve, reject) => {
        const encoder = new TextEncoder()
        resolve(new Uint8Array(encoder.encode(sonivox)))
      })
    },
    playMIDI(): void {
      console.log(synth)
      /*
      const player = new synth.AlphaSynth()
      player.loadSoundFont(this.sounds, false)
      player.loadMidiFile(this.audio)
      player.play()
      */
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
