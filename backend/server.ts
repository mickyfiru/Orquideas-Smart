import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createApplication } from './app.ts'

const mode = process.env.ORQ_MODE
if (mode !== undefined && mode !== 'simulation' && mode !== 'arduino') throw new Error('ORQ_MODE debe ser simulation o arduino.')
const path = resolve(process.env.ORQ_DB ?? 'data/orquideas.sqlite')
mkdirSync(dirname(path), { recursive: true })
const app = createApplication(path, mode ?? null, resolve('dist'))
app.server.listen(3001, '127.0.0.1', () => console.log('Orquídeas Smart · http://127.0.0.1:3001'))

const shutdown = () => void app.close()
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
