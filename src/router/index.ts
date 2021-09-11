import Vue from "vue"
import VueRouter, { RouteConfig } from "vue-router"
import Home from "@/views/Home.vue"
import NotFound from "@/views/NotFound.vue"
import About from "@/views/About.vue"

Vue.use(VueRouter)

const routes: Array<RouteConfig> = [
  {
    path: "/",
    name: "Home",
    component: Home,
  },
  {
    path: "/about",
    name: "About",
    component: About,
  },
  {
    path: "*",
    name: "NotFound",
    component: NotFound,
  },
]

const router = new VueRouter({
  base: process.env.NODE_ENV === "production" ? "/Tablatures/" : "/",
  mode: "history",
  routes,
})

export default router
