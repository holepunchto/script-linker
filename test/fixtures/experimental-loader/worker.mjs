import path from 'path'
import url from 'url'

const doImport = (s) => import(s)
const __dirname = path.dirname(url.fileURLToPath(import.meta.url)) // this throws on windows with C: in filepath
const sl = global[Symbol.for('scriptlinker')]
const myImport = sl.createImport(path.join(__dirname, '../esm-with-exports'), doImport)
const m = await myImport('./esm-with-exports')
console.log(m.default)