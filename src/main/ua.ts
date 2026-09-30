import { app } from 'electron'

export function chromeUserAgent(): string {
  const chrome = process.versions.chrome
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

export function applyUserAgentFallback(): void {
  app.userAgentFallback = chromeUserAgent()
}
