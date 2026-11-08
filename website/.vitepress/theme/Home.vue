<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { withBase } from 'vitepress'
import DotField from './components/DotField.vue'
import DemoPlayer from './components/DemoPlayer.vue'
import SignalStrip from './components/SignalStrip.vue'
import { setupLanding } from './motion/setupLanding'
import { useHomeCopy } from './i18n'

const { t, tm, isZh } = useHomeCopy()

const steps = tm('steps')
const stats = tm('stats')
const marquee = tm('marquee')
const modes = tm('modes')
const caps = tm('caps')
const compare = tm('compare')
const specs = tm('specs')
const shots = tm('shots')
const changelog = tm('changelog')
const faqs = tm('faqs')
const levelText = tm('levels')
const heroLines = tm('hero.title')
const heroLinesMobile = tm('hero.titleMobile')
// 中文标题逐字做位移动画；拉丁字母宽度不同，英文直接整行显示
const heroChars = computed(() =>
  heroLines.map((text: string, lineIndex: number) => ({
    cls: 'desktop-line',
    chars: [...String(text)].map((ch, i) => ({ ch, i: (lineIndex === 0 ? 0 : 10) + i }))
  }))
)

const ICONS = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 4.5v15l13-7.5Z"/></svg>'
}













const heroEl = ref<HTMLElement | null>(null)
const demoFrame = ref<HTMLElement | null>(null)
const progressEl = ref<HTMLElement | null>(null)
const railEl = ref<HTMLElement | null>(null)
const tabsEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const finalEl = ref<HTMLElement | null>(null)
const spotEl = ref<HTMLElement | null>(null)
const mode = ref('agent')
let stopLanding: (() => void) | null = null

onMounted(async () => {
  try {
    stopLanding = await setupLanding({
      heroEl,
      demoFrame,
      progressEl,
      railEl,
      tabsEl,
      panelEl,
      finalEl,
      spotEl,
      mode,
      faqs
    })
  } catch {
    stopLanding = null
  }
})

onUnmounted(() => {
  stopLanding?.()
})

</script>

<template>
  <div class="landing">
    <div ref="progressEl" class="progress" aria-hidden="true" />
    <section ref="heroEl" class="hero">
      <DotField class="hero-field" :gap="22" :radius="140" :push="34" />
      <div class="inner">
        <a class="notice" href="#changelog">
          <span class="notice-tag">{{ t('hero.notice.tag') }}</span>
          <span class="notice-text">{{ t('hero.notice.text') }}</span>
          <span class="notice-arrow" v-html="ICONS.arrow" />
        </a>
        <div class="hero-inner">
          <span class="hero-kicker">{{ t('hero.kicker') }}</span>
          <h1 class="hero-title">
            <template v-if="isZh">
              <span class="line desktop-line">
                <span v-for="(c, i) in heroLines[0]" :key="'d' + i" class="ch" :style="{ '--ci': i }">{{ c }}</span>
              </span>
              <span class="line desktop-line">
                <span v-for="(c, i) in heroLines[1]" :key="'e' + i" class="ch" :style="{ '--ci': 10 + i }">{{ c }}</span>
              </span>
            </template>
            <template v-else>
              <span v-for="(line, li) in heroLines" :key="li" class="line desktop-line">{{ line }}</span>
            </template>
            <span v-for="(line, li) in heroLinesMobile" :key="'m' + li" class="line mobile-line">{{ line }}</span>
          </h1>
          <p class="hero-sub">{{ t('hero.sub') }}</p>
          <div class="hero-cta">
            <a v-press class="btn primary big" :href="withBase('/download.html')">
              {{ t('hero.cta.download') }}
              <span class="arw" v-html="ICONS.arrow" />
            </a>
            <a v-press class="btn ghost" href="#demo">
              <span v-html="ICONS.play" style="display:inline-flex;width:14px;height:14px" />
              {{ t('hero.cta.watch') }}
            </a>
            <a
              v-press
              class="btn quiet"
              href="https://github.com/xy200303/browserpilot"
              target="_blank"
              rel="noreferrer"
            >GitHub</a>
          </div>
          <div class="hero-meta">
            <span v-for="(item, i) in tm('hero.meta')" :key="i">{{ item }}</span>
          </div>
        </div>
      </div>
      <SignalStrip class="hero-signal" :height="64" :lines="3" />
    </section>

    <section id="demo" class="demo">
      <div class="inner">
        <div class="demo-frame-wrap">
          <div ref="demoFrame" class="demo-frame">
          <div class="window">
            <div class="window-bar">
              <i /><i /><i />
              <span>{{ t('demo.bar') }}</span>
            </div>
            <DemoPlayer />
          </div>
          </div>
        </div>
        <div class="demo-caption">
          <p>
            <strong>{{ t('demo.captionStrong') }}</strong>{{ t('demo.caption') }}
          </p>
          <span class="demo-time">{{ t('demo.time') }}</span>
        </div>
        <div class="demo-notes">
          <div v-for="(note, i) in tm('demo.notes')" :key="i"><b>{{ note.b }}</b>{{ note.text }}</div>
        </div>
      </div>
    </section>

    <section class="statband">
      <div class="inner">
        <ul class="stats">
          <li v-for="(s, i) in stats" :key="s.label" class="stat reveal" :style="{ transitionDelay: i * 70 + 'ms' }">
            <strong>{{ s.value }}</strong>
            <span class="stat-label">{{ s.label }}</span>
            <span class="stat-note">{{ s.note }}</span>
          </li>
        </ul>
      </div>
    </section>

    <div class="marquee" aria-hidden="true">
      <div class="marquee-track">
        <span v-for="(w, i) in [...marquee, ...marquee]" :key="i" class="marquee-word">
          {{ w }}<i>·</i>
        </span>
      </div>
    </div>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>01</i>{{ t('how.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('how.title')" />
        <p class="lead reveal">{{ t('how.lead') }}</p>
        <div ref="railEl" class="pipe-rail" aria-hidden="true">
          <span class="rail-line" />
          <span v-for="n in 3" :key="n" class="rail-dot" />
        </div>
        <div class="steps">
          <figure v-for="s in steps" :key="s.n" class="step reveal" v-lift="2" v-spot>
            <div class="window sm">
              <div class="window-bar"><i /><i /><i /><span>BrowserPilot</span></div>
              <img :src="withBase(s.src)" :alt="s.alt" loading="lazy" />
            </div>
            <figcaption>
              <h3><span class="num">{{ s.n }}</span>{{ s.title }}</h3>
              <p>{{ s.desc }}</p>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>02</i>{{ t('capsSection.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('capsSection.title')" />
        <p class="lead reveal">{{ t('capsSection.lead') }}</p>
        <div class="caps">
          <article v-for="c in caps" :key="c.title" class="cap reveal" v-lift="2" v-spot>
            <h3>{{ c.title }}</h3>
            <p class="cap-lead">{{ c.lead }}</p>
            <ul>
              <li v-for="it in c.items" :key="it.t">
                <strong>{{ it.t }}</strong>。{{ it.d }}
                <span class="cap-meta">
                  <code>{{ it.tool }}</code>
                  <span :class="['badge', it.level]">{{ levelText[it.level] }}</span>
                </span>
              </li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <section class="section tabs-section">
      <div class="inner">
        <span class="eyebrow reveal"><i>·</i>{{ t('modesSection.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('modesSection.title')" />
        <p class="lead reveal">{{ t('modesSection.lead') }}</p>
        <div ref="tabsEl" class="tabs reveal" role="tablist">
          <button
            v-for="m in modes"
            :key="m.id"
            v-press
            type="button"
            role="tab"
            :aria-selected="mode === m.id"
            :class="['tab', mode === m.id && 'on']"
            @click="mode = m.id"
          >
            {{ m.name }}
          </button>
          <span class="tab-bar" aria-hidden="true" />
        </div>
        <div ref="panelEl" class="track-panel reveal" v-spot>
          <template v-for="m in modes" :key="m.id">
            <div v-if="mode === m.id" class="track-body">
              <p class="track-lead">{{ m.lead }}</p>
              <ul class="track-items">
                <li v-for="it in m.items" :key="it.t">
                  <strong>{{ it.t }}</strong>
                  <span>{{ it.d }}</span>
                </li>
              </ul>
              <a class="track-link" :href="withBase(m.to)">
                {{ m.toText }} <span v-html="ICONS.arrow" />
              </a>
            </div>
          </template>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>03</i>{{ t('control.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('control.title')" />
        <p class="lead reveal">{{ t('control.lead') }}</p>
        <div class="loop">
          <div class="reveal">
            <table class="loop-table">
              <thead>
                <tr><th v-for="(head, i) in tm('control.tableHead')" :key="i">{{ head }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in tm('control.rows')" :key="i">
                  <td>{{ row.state }}</td>
                  <td>{{ row.show }}</td>
                  <td>{{ row.who }}</td>
                </tr>
              </tbody>
            </table>
            <div class="loop-warning">{{ t('control.audit') }}</div>
          </div>
          <div class="loop-points">
            <div v-for="(card, i) in tm('control.cards')" :key="i" class="loop-point reveal" v-spot>
              <h4>{{ card.h }}</h4>
              <p v-html="card.p" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>04</i>{{ t('bounds.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('bounds.title')" />
        <p class="lead reveal">{{ t('bounds.lead') }}</p>
        <div class="bounds">
          <div class="bound reveal" v-lift="2" v-spot>
            <h3>{{ t('bounds.doTitle') }}</h3>
            <ul>
              <li v-for="(item, i) in tm('bounds.do')" :key="i" v-html="item" />
            </ul>
          </div>
          <div class="bound no reveal" v-lift="2">
            <h3>{{ t('bounds.dontTitle') }}</h3>
            <ul>
              <li v-for="(item, i) in tm('bounds.dont')" :key="i" v-html="item" />
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>05</i>{{ t('integration.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('integration.title')" />
        <p class="lead reveal">{{ t('integration.lead') }}</p>
        <div class="integration-grid">
          <article class="codecard reveal" v-spot>
            <header><h3>{{ t('integration.mcpTitle') }}</h3><span>{{ t('integration.mcpTag') }}</span></header>
            <pre><code>{
  "mcpServers": {
    "browserpilot": {
      "type": "http",
      "url": "http://127.0.0.1:39221/mcp",
      "headers": { "Authorization": "Bearer REPLACE_WITH_TOKEN" }
    }
  }
}</code></pre>
            <p class="note" v-html="t('integration.mcpNote')" />
          </article>
          <article class="codecard reveal" v-spot>
            <header><h3>{{ t('integration.cliTitle') }}</h3><span>{{ t('integration.cliTag') }}</span></header>
            <pre><code>"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" tools
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" schema page_click
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" call workflow_run --name "{{ t('integration.sampleWorkflow') }}" --json-file C:\tasks\github.json</code></pre>
            <p class="note" v-html="t('integration.cliNote')" />
          </article>
          <article class="codecard reveal" v-spot>
            <header><h3>{{ t('integration.batchTitle') }}</h3><span>{{ t('integration.batchTag') }}</span></header>
            <pre><code>{
  "workflow": "{{ t('integration.sampleWorkflow') }}",
  "rows": [
    { "{{ t('integration.sampleKeyword') }}": "browser-automation" },
    { "{{ t('integration.sampleKeyword') }}": "headless-browser" }
  ],
  "concurrency": 2
}</code></pre>
            <p class="note">{{ t('integration.batchNote') }}</p>
          </article>
          <article class="codecard reveal" v-spot>
            <header><h3>{{ t('integration.taskTitle') }}</h3><span>{{ t('integration.taskTag') }}</span></header>
            <pre><code>set BROWSERPILOT_EXE=%LOCALAPPDATA%\Programs\BrowserPilot\BrowserPilot.exe
"%LOCALAPPDATA%\Programs\BrowserPilot\resources\cli\browserpilot.exe" ^
  call workflow_run --name "{{ t('integration.sampleWorkflow') }}" --json-file C:\tasks\github.json</code></pre>
            <p class="note" v-html="t('integration.taskNote')" />
          </article>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>06</i>{{ t('compareSection.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('compareSection.title')" />
        <p class="lead reveal">{{ t('compareSection.lead') }}</p>
        <p class="table-hint">{{ t('compareSection.hint') }}</p>
        <div class="table-wrap reveal">
          <table class="compare">
            <thead>
              <tr><th v-for="(head, i) in tm('compareSection.head')" :key="i">{{ head }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in compare" :key="row.scene">
                <td class="scene">{{ row.scene }}</td>
                <td>{{ row.hand }}</td>
                <td>{{ row.rpa }}</td>
                <td class="app">{{ row.bp }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>07</i>{{ t('specsSection.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('specsSection.title')" />
        <p class="lead reveal">{{ t('specsSection.lead') }}</p>
        <div class="table-wrap reveal">
          <table class="specs">
            <tbody>
              <tr v-for="s in specs" :key="s.k">
                <th>{{ s.k }}</th>
                <td>{{ s.v }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>08</i>{{ t('shotsSection.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('shotsSection.title')" />
        <p class="lead reveal">{{ t('shotsSection.lead') }}</p>
        <div class="shots">
          <figure v-for="(s, i) in shots" :key="s.title" class="shot reveal" v-spot :style="{ transitionDelay: (i % 3) * 60 + 'ms' }">
            <div class="window sm">
              <div class="window-bar"><i /><i /><i /><span>BrowserPilot</span></div>
              <img :src="withBase(s.src)" :alt="s.title" loading="lazy" />
            </div>
            <figcaption>
              <h3>{{ s.title }}</h3>
              <p>{{ s.desc }}</p>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="inner">
        <span class="eyebrow reveal"><i>09</i>{{ t('build.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('build.title')" />
        <p class="lead reveal">{{ t('build.lead') }}</p>
        <div class="dev-grid">
          <div class="dev-card reveal" v-spot>
            <h3>{{ t('build.h') }}</h3>
            <pre><code>$ git clone https://github.com/xy200303/browserpilot
$ npm install
$ npm run dev</code></pre>
            <p class="muted" v-html="t('build.commands')" />
          </div>
          <div class="dev-card reveal d1">
            <h3>{{ t('build.licenseTitle') }}</h3>
            <ul class="dev-list">
              <li v-for="(item, i) in tm('build.license')" :key="i" v-html="item" />
            </ul>
            <div class="license-note">{{ t('build.note') }}</div>
          </div>
        </div>
      </div>
    </section>

    <section id="changelog" class="section alt">
      <div class="inner">
        <span class="eyebrow reveal"><i>10</i>{{ t('changelogSection.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('changelogSection.title')" />
        <p class="lead reveal">{{ t('changelogSection.lead') }}</p>
        <div class="releases">
          <article v-for="r in changelog" :key="r.v" class="rel reveal" v-lift="2" v-spot>
            <div class="rel-head">
              <span class="rel-v">{{ r.v }}</span>
              <span class="rel-when">{{ r.when }}</span>
            </div>
            <ul>
              <li v-for="item in r.items" :key="item">{{ item }}</li>
            </ul>
          </article>
        </div>
        <p class="more reveal">
          {{ t('changelogSection.more') }}
          <a href="https://github.com/xy200303/browserpilot/releases" target="_blank" rel="noreferrer">GitHub Releases</a>.
        </p>
      </div>
    </section>

    <section class="section">
      <div class="inner narrow">
        <span class="eyebrow reveal"><i>11</i>{{ t('faqSection.eyebrow') }}</span>
        <h2 class="display reveal" v-html="t('faqSection.title')" />
        <div class="faq-list">
          <details
            v-for="(f, i) in faqs"
            :key="f.q"
            class="faq-item reveal"
            :open="i === 0"
          >
            <summary>{{ f.q }}</summary>
            <p>{{ f.a }}</p>
          </details>
        </div>
      </div>
    </section>

    <section ref="finalEl" class="final">
      <div ref="spotEl" class="spot" aria-hidden="true" />
      <div class="final-inner reveal">
        <h2 class="display" v-html="t('final.title')" />
        <p class="final-sub">
          {{ t('final.sub') }}
        </p>
        <div class="hero-cta">
          <a v-press class="btn primary big" href="https://github.com/xy200303/browserpilot/releases/latest" target="_blank" rel="noreferrer">
            {{ t('final.download') }}
            <span class="arw" v-html="ICONS.arrow" />
          </a>
          <a v-press class="btn ghost" :href="withBase('/guide/quickstart.html')">{{ t('final.docs') }}</a>
          <a v-press class="btn ghost" href="https://github.com/xy200303/browserpilot" target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <p class="footnote">
          {{ t('final.footnote') }}<br />
          {{ t('final.footnote2') }}
        </p>
      </div>
    </section>
  </div>
</template>
