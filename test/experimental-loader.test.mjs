import path from 'path'
import url from 'url'
import { spawn } from 'child_process'
import { once } from 'events'
import test from 'brittle'

const __dirname = path.join(url.fileURLToPath(import.meta.url), '..')

test('it should intercept resolve and load calls for esm', async function (t) {
  const loader = new URL('file://' + path.join(__dirname, './fixtures/experimental-loader/loader.mjs')).href
  const main = path.join(__dirname, './fixtures/experimental-loader/main.js')

  const args = ['--experimental-loader', loader, main]
  const child = spawn(process.execPath, args, { stdio: 'pipe' })
  t.teardown(() => child.kill('SIGINT'))

  child.stderr.pipe(process.stderr)

  const buf = await once(child.stdout, 'data')
  t.is(buf.toString().trim(), 'an export')
})
