<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { withBase } from 'vitepress'

const video = ref<HTMLVideoElement | null>(null)
const needsTap = ref(false)

function play(): void {
  const el = video.value
  if (!el) return
  el.muted = true
  void el.play().then(() => {
    needsTap.value = false
  }).catch(() => {
    needsTap.value = true
  })
}

onMounted(() => {
  // 手机低电量模式或省流模式会拦掉自动播放；失败时露出大按钮，点一下就能播
  void video.value?.play().then(() => {
    needsTap.value = false
  }).catch(() => {
    needsTap.value = true
  })
})
</script>

<template>
  <div class="demo-player">
    <video
      ref="video"
      :src="withBase('/demos/run.mp4')"
      :poster="withBase('/demos/run-poster.jpg')"
      autoplay
      muted
      loop
      playsinline
      controls
      preload="metadata"
      aria-label="BrowserPilot 真实运行录屏：在问卷星的在线考试里自动答完 5 道题并拿到 100 分"
      @playing="needsTap = false"
    />
    <button v-if="needsTap" class="demo-start" type="button" aria-label="播放演示视频" @click="play">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5Z" /></svg>
      <span>播放演示</span>
    </button>
  </div>
</template>

<style scoped>
.demo-player {
  position: relative;
  background: #1a1a19;
}
.demo-player video {
  display: block;
  width: 100%;
  aspect-ratio: 1440 / 900;
  object-fit: cover;
  background: #1a1a19;
}
.demo-start {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  border: 0;
  background: rgba(20, 19, 18, 0.38);
  color: #fff;
  font: 500 15px/1 var(--vp-font-family-base, system-ui);
  cursor: pointer;
}
.demo-start svg {
  width: 22px;
  height: 22px;
}
.demo-start:hover {
  background: rgba(20, 19, 18, 0.48);
}
</style>
