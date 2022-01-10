const { Worker, isMainThread } = require('worker_threads')
const fs = require('fs/promises')
const path = require('path')
const TRPC = require('thread-rpc')
const ScriptLinker = require('../../../index.js')
const unixresolve = require('unix-path-resolve')

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

async function e2e ({ entrypoint, listeners, linker, backend } = {}) {
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
    workerData: { entrypoint, type }
  })

  const rpc = new TRPC(worker)
  for (const listener of Object.entries(listeners)) {
    rpc.respond(...listener)
  }

  return { linker, worker, rpc }
}

module.exports = e2e
