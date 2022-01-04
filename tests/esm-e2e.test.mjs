import { Worker, isMainThread, parentPort } from 'worker_threads'
import { once } from 'events'
import ScriptLinker from '../index.js'
import os from 'os'
import * as fsp from 'fs/promises'
import fs, { writeFile } from 'fs'
import path from 'path'
import url from 'url'
import test from 'brittle'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const __filename = url.fileURLToPath(import.meta.url)

if (isMainThread) {
  // setup script linker backend
  const sl = new ScriptLinker({
    readFile: fsp.readFile,
    stat: fsp.stat,
    isFile (path) {
      return fsp.stat(path).then((s) => s.isFile(), () => false)
    },
    isDirectory (path) {
      return fsp.stat(path).then((s) => s.isDirectory(), () => false)
    }
  })

  // setup cross-thread communication channels
  const bufs = { // these bufs represent events
    read: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)),
    write: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  }
  const tmpdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'e2e-'))
  const fnames = { // these files store var length bytes
    read: path.join(tmpdir, 'r.raw'),
    write: path.join(tmpdir, 'w.raw')
  }

  // load worker and send init message
  const worker = new Worker(__filename) 
  worker.postMessage({ 
    bufs: { read: bufs.write, write: bufs.read },
    fnames: { read: fnames.write, write: fnames.read }
  })

  let _cleaning = null

  // core loop: dispatch on op
  for await (const op of spinlockish(bufs.read)) {
    if (op === 1) { // resolve
      await handleOp((args) => sl.resolve(...args))
    } else if (op === 2) { // get
      await handleOp((args) => sl.load(...args).then((m) => m.toESM()))
    } else if (op === 3) { // exec test
      const buf = await fsp.readFile(fnames.read)
      const [exported] = JSON.parse(buf.toString())
      const assert = test('it should resolve cjs module')
      assert.teardown(async () => {
        if (!_cleaning) _cleaning = cleanup()
        return _cleaning
      })
      assert.plan(1)
      assert.is(exported, 'an export')
      break
    } else {
      console.log('unrecognized op', op)
      if (!_cleaning) _cleaning = cleanup()
      await _cleaning
      break
    }
  }

  async function cleanup () {
    await worker.terminate()
    await fsp.rm(tmpdir, { recursive: true })
  }

  async function handleOp (handler) {
    const buf = await fsp.readFile(fnames.read)
    const args = JSON.parse(buf.toString())
    await fsp.writeFile(fnames.write, await handler(args))
    Atomics.store(bufs.write, 0, 1)
    Atomics.notify(bufs.write, 0, 1)
  }
} else {
  const [{ bufs, fnames }] = await once(parentPort, 'message')

  const linker = ScriptLinker.preload({
    resolveSync: invoke.bind(null, 1),
    getSync: invoke.bind(null, 2),
    map (x) { return x }
  })

  const myimport = linker.createImport(
    path.join(__dirname, 'fixtures'),
    (r) => import('file://' + r) 
  )

  try {
    const { default: exported } = await myimport('./fixtures/esm-with-exports/index.js')
    invoke(3, exported)
  } catch (e) {
    console.log(e)
  }

  function invoke (op = -1, ...args) {
    console.log(op)
    fs.writeFileSync(fnames.write, JSON.stringify(args))
    Atomics.store(bufs.write, 0, op) // set op
    Atomics.wait(bufs.read, 0, 0) // wait
    Atomics.store(bufs.read, 0, 0) // reset
    const buf = fs.readFileSync(fnames.read)
    const str = buf.toString()
    return str
  }
}

async function * spinlockish (read) {
  while (true) {
    if (read[0]) {
      const op = read[0] // get op
      Atomics.store(read, 0, 0) // reset
      yield op
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
}