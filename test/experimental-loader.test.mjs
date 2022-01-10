import unixresolve from 'unix-path-resolve'
import url from 'url'
import { spawn } from 'child_process'
import { once } from 'events'
import test from 'brittle'

const __dirname = unixresolve(url.fileURLToPath(import.meta.url), '..')
const child = spawn(
  process.execPath,
  [
    '--experimental-loader',
    unixresolve(__dirname, './fixtures/experimental-loader/loader.mjs'),
    unixresolve(__dirname, './fixtures/experimental-loader/main.js')
  ],
  { stdio: 'pipe' }
)

test('it should intercept resolve and load calls for esm', async ({ is, teardown }) => {
  teardown(() => child.kill('SIGINT'))
  const buf = await once(child.stdout, 'data')
  is(buf.toString().trim(), 'an export')
})