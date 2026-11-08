export type GridRenderOptions = {
  step: number
  labelStep: number
  originX: number
  originY: number
  spanWidth: number
  spanHeight: number
  showOrigin: boolean
  edgeOnly: boolean
  alpha: number
  block: number
  toneWidth: number
  toneHeight: number
  tone: number[]
  colors: string[]
  jpeg?: boolean
}

export type GridRenderRequest = {
  id: string
  png: Uint8Array
  options: GridRenderOptions
}
