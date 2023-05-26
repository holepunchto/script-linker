import path from 'path'
import url from 'url'
import { spawn } from 'child_process'
import { once } from 'events'
import test from 'brittle'

const __dirname = path.join(url.fileURLToPath(import.meta.url), '..')

test.skip('it should intercept resolve and load calls for esm', async ({ is, teardown }) => {
  const child = spawn(
    process.execPath,
    [
      '--experimental-loader',
      new URL('file://' + path.join(__dirname, './fixtures/experimental-loader/loader.mjs')).href,
      path.join(__dirname, './fixtures/experimental-loader/main.js')
    ],
    { stdio: 'pipe' }
  )
  child.stderr.pipe(process.stderr)
  teardown(() => child.kill('SIGINT'))
  const buf = await once(child.stdout, 'data')
  is(buf.toString().trim(), 'an export')
})
