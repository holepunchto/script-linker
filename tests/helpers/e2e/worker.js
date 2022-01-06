const { isMainThread, parentPort, workerData } = require('worker_threads')
const ScriptLinker = require('../../../index.js')
const TRPC = require('thread-rpc')

async function main () {
  if (isMainThread) return

<<<<<<< HEAD
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
=======
  const { entrypoint, root = '/', type = 'commonjs' } = workerData
  if (!entrypoint) throw new Error('Must pass an entrypoint!')
  const rpc = new TRPC(parentPort)
  const linker = ScriptLinker.preload({
    resolveSync (...args) { return rpc.requestSync('resolve', { args }) },
    getSync: (...args) => { return rpc.requestSync('get', { args }) },
    map (x) { return x }
  })
  const loader = (type === 'commonjs')
    ? linker.createRequire(root)
    : linker.createImport(root, (url) => import(/^file:\/\//.test(url) ? url : 'file://' + url))
  const tfn = await loader(entrypoint)
  
  await tfn({ entrypoint, root, type, rpc, linker, loader })
}

main().then(
  () => setTimeout(() => process.exit(0), 500), // TODO: how to flush stdout before exiting worker?
  () => process.exit(1)
)
>>>>>>> 18482d51e3d76cee081254cd2cebdabe0c0d6a84
