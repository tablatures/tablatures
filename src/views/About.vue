<template>
  <v-container>
    <div class="centered">
      <div class="container">
        <div class="text-h1" style="font-size: 16em !important; padding: 0.3em">404</div>
        <div class="text-h4 text-center">The page you requested couldn't be found...</div>
        <v-btn class="ma-3" color="primary" link @click="returnHome">go back to home</v-btn>
      </div>
    </div>
  </v-container>
</template>

 <script>
import Vue from "vue"

export default Vue.extend({
  name: "About",
  methods: {
    returnHome() {
      this.$router.push({ name: "Home" })
    },
  },
})
</script>

<style lang="scss" scoped>
.centered {
  position: absolute;
  top: 50%;
  left: 50%;
  -webkit-transform: translate(-50%, -50%);
  transform: translate(-50%, -50%);
}
.container {
  display: -webkit-flexbox;
  display: -ms-flexbox;
  display: -webkit-flex;
  display: flex;
  -webkit-flex-align: center;
  -ms-flex-align: center;
  -webkit-align-items: center;
  align-items: center;
  justify-content: center;
  flex-direction: column;
}
</style>
