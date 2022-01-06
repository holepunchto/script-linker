const { Worker, isMainThread } = require('worker_threads')
const fs = require('fs/promises')
const path = require('path')
const TRPC = require('thread-rpc')
const ScriptLinker = require('../../../index.js')

const defaultBackend = {
  readFile: fs.readFile,
  stat: fs.stat,
  isFile (path) {
    return fs.stat(path).then((s) => s.isFile(), () => false)
  },
  isDirectory (path) {
    return fs.stat(path).then((s) => s.isDirectory(), () => false)
  }
}

<<<<<<< HEAD
async function e2e ({ entrypoint, listeners, linker, backend } = {}) {
=======
async function e2e ({ entrypoint, root, listeners, linker, backend } = {}) {
>>>>>>> 18482d51e3d76cee081254cd2cebdabe0c0d6a84
  if (!isMainThread) return
  if (!entrypoint) throw new Error('Must pass entrypoint')

  linker = linker || new ScriptLinker(backend || defaultBackend)

  const mod = await linker.load(entrypoint)
  const { type } = mod

  const defaultListeners = {
    resolve ({ args }) {
      return linker.resolve(...args)
    },
    get ({ args }) {
      return linker.load(...args).then((m) => (type === 'commonjs') ? m.toCJS() : m.toESM())
    }
  }

  listeners = { ...defaultListeners, ...listeners }

  const worker = new Worker(path.join(__dirname, './worker.js'), {
<<<<<<< HEAD
    workerData: { entrypoint, type }
=======
    workerData: { entrypoint, root, type }
>>>>>>> 18482d51e3d76cee081254cd2cebdabe0c0d6a84
  })

  const rpc = new TRPC(worker)
  for (const listener of Object.entries(listeners)) {
    rpc.respond(...listener)
  }
}

module.exports = e2e
