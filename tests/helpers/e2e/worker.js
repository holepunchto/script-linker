const { isMainThread, parentPort, workerData } = require('worker_threads')
const ScriptLinker = require('../../../index.js')
const TRPC = require('thread-rpc')

async function main () {
  if (isMainThread) return

  const { entrypoint, type = 'commonjs' } = workerData
  if (!entrypoint) throw new Error('Must pass an entrypoint!')
  const rpc = new TRPC(parentPort)
  const opts = {
    resolveSync (...args) { return rpc.requestSync('resolve', { args }) },
    getSync: (...args) => { return rpc.requestSync('get', { args }) },
    map (x) { return x }
  }
  const linker = ScriptLinker.runtime(opts)
  linker._rpc = rpc // lets caller rebuild runtime
  linker._opts = opts // lets caller selectively overwrite def runtime opts
  const loader = (type === 'commonjs')
    ? linker.createRequire(entrypoint)
    : linker.createImport(entrypoint, (x) => import(x))
  await loader(entrypoint) // add bootstrap method with these four
}

main()
