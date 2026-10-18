import { defineConfig } from 'vitepress'

const APP_VERSION = '0.13.13'
const SITE_ORIGIN = 'https://browser.xyun.dev'
const BASE = '/'
const SITE_URL = `${SITE_ORIGIN}${BASE}`
const SITE_NAME = 'BrowserPilot'
const SITE_DESC =
  'BrowserPilot 是给 Agent 用的本机浏览器：一套环境一套登录，Agent 在同一扇窗口里点击、填表、等待、提取结果；人随时可以接管。Windows / macOS / Linux，本机 MCP 与工作流。'
const OG_IMAGE = `${SITE_URL}og-image.png`

const softwareJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: SITE_NAME,
  alternateName: 'BrowserPilot 浏览器',
  description: SITE_DESC,
  url: SITE_URL,
  downloadUrl: 'https://github.com/xy200303/browserpilot/releases/latest',
  softwareVersion: APP_VERSION,
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'Browser Automation',
  operatingSystem: 'Windows, macOS, Linux',
  inLanguage: 'zh-CN',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
  author: { '@type': 'Person', name: 'xy200303', url: 'https://github.com/xy200303' },
  keywords:
    '浏览器自动化,AI Agent,MCP,工作流,CDP,XPath,登录态,人机协作,网页操作,BrowserPilot',
  featureList:
    '同窗口人机协作,多套隔离环境,Agent 通过本机 MCP 操作浏览器,工作流一次跑完,标签级抓包,媒体保存,极验滑块识别,CDP 调试'
}

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
  inLanguage: 'zh-CN',
  description: SITE_DESC
}

export default defineConfig({
  lang: 'zh-CN',
  title: SITE_NAME,
  titleTemplate: ':title | BrowserPilot',
  description: SITE_DESC,
  appearance: 'force-light',
  base: BASE,
  srcExclude: ['README.md'],
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}favicon.svg` }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${BASE}favicon-32.png` }],
    ['link', { rel: 'apple-touch-icon', href: `${BASE}apple-touch-icon.png` }],
    ['link', { rel: 'stylesheet', href: `${BASE}fonts/noto/noto-sans-sc.css` }],
    ['link', { rel: 'stylesheet', href: `${BASE}fonts/mono/jetbrains-mono.css` }],
    ['meta', { name: 'keywords', content: 'BrowserPilot,浏览器自动化,AI Agent,MCP,工作流,CDP,登录态,人机协作,网页操作,Electron' }],
    ['meta', { name: 'author', content: 'xy200303' }],
    ['meta', { name: 'robots', content: 'index, follow, max-image-preview:large, max-snippet:-1' }],
    ['meta', { name: 'theme-color', content: '#f9f9f8' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:locale', content: 'zh_CN' }],
    ['meta', { property: 'og:title', content: 'BrowserPilot — 让 Agent 用你登录好的浏览器' }],
    ['meta', { property: 'og:description', content: SITE_DESC }],
    ['meta', { property: 'og:url', content: SITE_URL }],
    ['meta', { property: 'og:image', content: OG_IMAGE }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'BrowserPilot — 给 Agent 用的本机浏览器' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'BrowserPilot — 让 Agent 用你登录好的浏览器' }],
    ['meta', { name: 'twitter:description', content: SITE_DESC }],
    ['meta', { name: 'twitter:image', content: OG_IMAGE }],
    ['script', { type: 'application/ld+json' }, JSON.stringify(softwareJsonLd)],
    ['script', { type: 'application/ld+json' }, JSON.stringify(websiteJsonLd)]
  ],
  transformHead({ pageData }) {
    const rel = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '.html')
    const canonical = `${SITE_URL}${rel}`
    const head: [string, Record<string, string>][] = [['link', { rel: 'canonical', href: canonical }]]
    if (pageData.frontmatter.description) {
      head.push(['meta', { property: 'og:url', content: canonical }])
    }
    return head
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '演示', link: '/#demo' },
      { text: '文档', link: '/guide/quickstart' },
      { text: '下载', link: '/download' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: '上手',
          items: [
            { text: '快速上手', link: '/guide/quickstart' },
            { text: '核心概念', link: '/guide/concepts' },
            { text: '界面一览', link: '/guide/interface' }
          ]
        },
        {
          text: '使用与排错',
          items: [
            { text: '可复制用例', link: '/guide/recipes' },
            { text: '常见失败与数据位置', link: '/guide/troubleshooting' }
          ]
        },
        {
          text: '安装',
          items: [{ text: '下载与备份', link: '/download' }]
        }
      ]
    },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/xy200303/browserpilot' }],
    outline: { label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    footer: {
      message:
        '源码公开可读，仓库暂未附 LICENSE · <a href="https://github.com/xy200303/browserpilot">GitHub</a> · <a href="https://github.com/xy200303/browserpilot/releases">更新日志</a> · <a href="https://github.com/xy200303/browserpilot/issues">反馈问题</a>',
      copyright: `Copyright © 2026 ${SITE_NAME} · v${APP_VERSION}`
    }
  }
})
