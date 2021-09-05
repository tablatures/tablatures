<template>
  <v-container>
    <v-file-input v-model="file" @change="onChange"></v-file-input>
    <div v-if="loading">loading...</div>
    <div v-for="(s, i) in svg" :key="i">
      <div v-html="s.svg"></div>
    </div>
  </v-container>
</template>

<script lang="ts">
import { importer, rendering, Settings } from "@coderline/alphatab"

// const settings = new alphaTab.Settings()
//const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(fileData), settings)

export default {
  name: "TabReader",
  data() {
    return {
      file: new Blob(),
      bytes: new Uint8Array(),
      score: null as any,
      svg: [] as Array<any>,
      loading: false,
    }
  },
  methods: {
    async onChange(e: Blob): Promise<void> {
      this.bytes = await this.loadBytes(e)
      this.score = importer.ScoreLoader.loadScoreFromBytes(this.bytes)
      console.log(this.score)
      this.generateSVG()
    },
    async loadBytes(e: Blob): Promise<Uint8Array> {
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
    generateSVG(): void {
      const renderer = new rendering.ScoreRenderer(new Settings())
      renderer.width = 1200
      renderer.settings.core.engine = "svg"

      renderer.preRender.on((isResize: any) => {
        this.svg = [] // clear on new rendering
        this.loading = true
      })

      renderer.partialRenderFinished.on((r: any) => {
        this.svg.push({
          svg: r.renderResult, // svg string
          width: r.width,
          height: r.height,
        })
      })

      renderer.renderFinished.on((r: any) => {
        this.loading = false
      })

      // 4. Fire off rendering
      renderer.renderScore(this.score, [0])
    },
    generateMIDI(): void {
      // TODO: https://www.alphatab.net/docs/guides/lowlevel-apis#generating-midi-files-via-midifilegenerator
    },
  },
}
</script>
<style lang="scss">
.at-surface * {
  cursor: default;
  vertical-align: top;
  overflow: visible;
}
.at {
  font-family: "alphaTab";
  speak: none;
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
