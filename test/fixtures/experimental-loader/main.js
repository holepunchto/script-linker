import path from 'path'
import e2e from '../../helpers/e2e/index.js'
import url from 'url'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const { linker } = await e2e({ 
  entrypoint: path.resolve(__dirname, './worker.mjs'),
  listeners: {
    async resolveESM (args) {
      const { specifier } = args
      return { 
        url: 'file://' + path.resolve(specifier) 
      }
    },
    async getESM (args) {
      const { url: resolvedURL, context } = args
      const fpath = resolvedURL.replace('file://', '')
      const mod = await linker.load(fpath)
      const source = mod.source
      const { format = 'module' } = context
      return { format, source }
    }
  } 
})
