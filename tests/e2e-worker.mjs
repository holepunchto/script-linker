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
  /* setup script linker backend */
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

  /* setup xthread comms */
  const worker = new Worker(__filename) // load worker
  const rshared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT) // child -> parent
  const wshared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT) // parent -> child
  const rbuf = new Int32Array(rshared) // child -> parent
  const wbuf = new Int32Array(wshared) // parent -> child
  const tmpdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'e2e-'))
  const rfilename = path.join(tmpdir, 'r.raw') // child -> parent
  const wfilename = path.join(tmpdir, 'w.raw') // parent -> child

  const bufs = { write: wbuf, read: rbuf }
  const fnames = { write: wfilename, read: rfilename }

  worker.postMessage({ 
    bufs: { read: wshared, write: rshared }, // braid r, w
    fnames: { read: wfilename, write: rfilename } // braid r, w
  })

  // core loop
  for await (const op of loop(bufs.read)) {
    if (op === 1) {
      const buf = await fsp.readFile(fnames.read)
      const args = JSON.parse(buf.toString())
      const r = await sl.resolve(...args)
      await fsp.writeFile(fnames.write, r)
      Atomics.store(bufs.write, 0, 1)  // set read ready
      Atomics.notify(bufs.write, 0, 1) // notify reader
    } else if (op === 2) {
      const buf = await fsp.readFile(fnames.read)
      const args = JSON.parse(buf.toString())
      const mod = await sl.load(...args)
      const src = await mod.toCJS()
      await fsp.writeFile(fnames.write, src)
      Atomics.store(bufs.write, 0, 1)  // set read ready
      Atomics.notify(bufs.write, 0, 1) // notify reader
    } else if (op === 3) {
      const buf = await fsp.readFile(fnames.read)
      const assert = test('it should resolve cjs module')
      assert.teardown(async () => {
        await worker.terminate()
        await fsp.rm(tmpdir, { recursive: true })
      })
      assert.plan(1)
      assert.is(buf.toString(), 'an export')
      break
    } else {
      console.log('unrecognized op', op)
      break
    }
  }
} else {
  const [{ bufs, fnames }] = await once(parentPort, 'message')
  bufs.read = new Int32Array(bufs.read)
  bufs.write = new Int32Array(bufs.write)

  const linker = ScriptLinker.preload({
    resolveSync (...args) {
      fs.writeFileSync(fnames.write, JSON.stringify(args))
      Atomics.store(bufs.write, 0, 1) // set op
      Atomics.wait(bufs.read, 0, 0) // wait
      Atomics.store(bufs.read, 0, 0) // reset
      const buf = fs.readFileSync(fnames.read)
      const str = buf.toString()
      return str
    },
    getSync (...args) {
      fs.writeFileSync(fnames.write, JSON.stringify(args))
      Atomics.store(bufs.write, 0, 2) // set op
      Atomics.wait(bufs.read, 0, 0) // wait
      Atomics.store(bufs.read, 0, 0) // reset
      const buf = fs.readFileSync(fnames.read)
      const str = buf.toString()
      return str
    },
    map (x) { return x }
  })
  const myrequire = linker.createRequire(path.join(__dirname, 'fixtures'))
  const exported = myrequire('./fixtures/cjs-with-exports/index.js')
  fs.writeFileSync(fnames.write, exported)
  Atomics.store(bufs.write, 0, 3)
  Atomics.wait(bufs.read, 0, 0)
}

async function * loop (read) {
  while (true) {
    if (read[0]) {
      const op = read[0] // read
      Atomics.store(read, 0, 0) // reset (unecessary?)
      yield op // yield
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
}