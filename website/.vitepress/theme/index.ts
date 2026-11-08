import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Home from './Home.vue'
import HomeEn from './HomeEn.vue'
import { vLift, vPress, vSpot } from './motion/directives'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Home', Home)
    app.component('HomeEn', HomeEn)
    app.directive('press', vPress)
    app.directive('lift', vLift)
    app.directive('spot', vSpot)
  }
} satisfies Theme
