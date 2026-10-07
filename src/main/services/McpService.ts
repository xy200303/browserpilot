import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { storage } from './store'
import { callTool, listToolMeta } from './tool-catalog'

let httpServer: ReturnType<typeof createServer> | null = null
let token = randomBytes(24).toString('hex')

function endpointFile(): string {
  return join(storage.userData(), 'mcp.json')
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function buildMcp(): Server {
  const server = new Server({ name: 'browserpilot', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listToolMeta() }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await callTool(request.params.name, request.params.arguments)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  })
  return server
}

export async function startMcp(): Promise<void> {
  await stopMcp()
  if (!storage.settings.mcpEnabled) return
  const existing = existsSync(endpointFile()) ? JSON.parse(readFileSync(endpointFile(), 'utf8')) as { token?: string } : {}
  if (existing.token) token = existing.token
  const port = storage.settings.port
  httpServer = createServer(async (req, res) => {
    try {
      await handle(req, res)
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
  })
  await new Promise<void>((resolve, reject) => {
    httpServer!.once('error', reject)
    httpServer!.listen(port, '127.0.0.1', () => resolve())
  })
  writeFileSync(endpointFile(), JSON.stringify({
    url: `http://127.0.0.1:${port}/mcp`,
    token
  }, null, 2))
}

export async function stopMcp(): Promise<void> {
  if (!httpServer) return
  await new Promise<void>((resolve) => httpServer!.close(() => resolve()))
  httpServer = null
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (url.pathname !== '/mcp') {
    res.writeHead(404)
    res.end()
    return
  }
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401)
    res.end('unauthorized')
    return
  }
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, tools: listToolMeta() }))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end()
    return
  }
  const body = await readBody(req)
  const server = buildMcp()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, body)
}
