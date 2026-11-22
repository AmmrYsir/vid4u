import type { FastifyInstance } from 'fastify'
import type { ToolChecker } from '../services/tools.js'

export function registerHealthRoute(app: FastifyInstance, tools: ToolChecker): void {
  app.get('/api/health', async (_request, reply) => {
    const health = await tools.check()
    reply.header('Cache-Control', 'no-store')
    return health
  })
}
