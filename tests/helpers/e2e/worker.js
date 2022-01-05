const { isMainThread, parentPort, workerData } = require('worker_threads')
const ScriptLinker = require('../../../index.js')
const TRPC = require('thread-rpc')

async function main () {
  if (isMainThread) return

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
