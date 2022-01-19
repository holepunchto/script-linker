// tests script linker with node fs interface
import test from 'brittle'
import fs from 'fs/promises'
import path from 'path'
import url from 'url'
import unixresolve from 'unix-path-resolve'
import ScriptLinker from '../index.js'
import { Module } from 'module'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

test('it resolves builtins', async ({ is }) => {
  const sl = scriptlinker()
  const mpath = await sl.resolve('events')
  is(mpath, 'events')
})

test('it loads builtins', async ({ is }) => {
  const sl = scriptlinker()
  const mod = await sl.load('events')
  is(mod.filename, 'events')
  is(mod.dirname, '/')
  is(mod.builtin, true)
  is(mod.type, 'module')
  is(mod.package, null)
  is(mod.source, (`
const mod = global[Symbol.for('scriptlinker')].require("events")
export const once = mod.once
export const on = mod.on
export const getEventListeners = mod.getEventListeners
export const EventEmitter = mod.EventEmitter
export const usingDomains = mod.usingDomains
export const captureRejectionSymbol = mod.captureRejectionSymbol
export const captureRejections = mod.captureRejections
export const errorMonitor = mod.errorMonitor
export const defaultMaxListeners = mod.defaultMaxListeners
export const setMaxListeners = mod.setMaxListeners
export const init = mod.init
export const listenerCount = mod.listenerCount
export default mod
  `).trim())
  // domain mutually exclusive w brittle through uncaught exception capture callback registration,
  // repl mutually exclusive w brittle through domain
  for (const modName of Module.builtinModules.filter((name) => !(['domain', 'repl']).includes(name))) is((await sl.load(modName)).filename, modName)
})

test('(cjs) it finds package.json by filename', async ({ is }) => {
  const sl = scriptlinker()
  const pj = await sl.findPackageJSON(unixresolve(__dirname, './fixtures/cjs/index.js'))
  is(pj.name, 'commonjs-app')
})

test('(cjs) it finds package.json by directory name', async ({ is }) => {
  const sl = scriptlinker()
  const pj = await sl.findPackageJSON(unixresolve(__dirname, './fixtures/cjs/'), { directory: true })
  is(pj.name, 'commonjs-app')
})

test('(cjs) it resolves modules', async ({ is }) => {
  const sl = scriptlinker()
  const mpath = await sl.resolve(
    './fixtures/cjs/lib/dep-a.js',
    __dirname
  )
  is(mpath, unixresolve(__dirname, './fixtures/cjs/lib/dep-a.js'))
})

test('(cjs) it loads module', async ({ is, ok }) => {
  const sl = scriptlinker()
  const fpath = unixresolve(__dirname, './fixtures/cjs/index.js')
  const mod = await sl.load(fpath)
  is(mod.filename, unixresolve(fpath))
  is(mod.dirname, unixresolve(fpath, '..'))
  is(mod.builtin, false)
  is(mod.type, 'commonjs')
  is(mod.package.name, (await sl.findPackageJSON(fpath)).name)
  is(mod.source, (await fs.readFile(fpath)).toString())
  is(mod.resolutions.length, 2)
  ok(mod.resolutions.some((r) => r.output.includes('dep-a')))
  ok(mod.resolutions.some((r) => r.output.includes('dep-b')))
  is(mod.exports.named.length, 0)
})

test('(cjs) it converts to ESM', async ({ ok }) => {
  const sl = scriptlinker()
  const fpath = unixresolve(__dirname, './fixtures/cjs/index.js')
  const mod = await sl.load(fpath)
  const asESM = await mod.toESM()
  ok(asESM) // TODO write to disk and reimport
})

test('(cjs) it converts to JSON if .json', async ({ is }) => {
  const sl = scriptlinker()
  const fpath = unixresolve(__dirname, './fixtures/cjs/package.json')
  const mod = await sl.load(fpath)
  const json = await mod.toCJS()
  is(json, (await fs.readFile(fpath)).toString())
})

test('(esm) it finds package.json by filename', async ({ is }) => {
  const sl = scriptlinker()
  const pj = await sl.findPackageJSON(unixresolve(__dirname, './fixtures/esm/index.js'))
  is(pj.name, 'esm-app')
})

test('(esm) it finds package.json by directory name', async ({ is }) => {
  const sl = scriptlinker()
  const pj = await sl.findPackageJSON(unixresolve(__dirname, './fixtures/esm/'), { directory: true })
  is(pj.name, 'esm-app')
})

test('(esm) it resolves module', async ({ is }) => {
  const sl = scriptlinker()
  const mpath = await sl.resolve(
    './fixtures/esm/lib/dep-a.js',
    __dirname
  )
  is(mpath, unixresolve(unixresolve(__dirname, './fixtures/esm/lib/dep-a.js')))
})

test('(esm) it loads module', async ({ is, ok }) => {
  const sl = scriptlinker()
  const fpath = unixresolve(__dirname, './fixtures/esm/index.js')
  const mod = await sl.load(fpath)
  is(mod.filename, unixresolve(fpath))
  is(mod.dirname, path.dirname(unixresolve(fpath)))
  is(mod.builtin, false)
  is(mod.type, 'module')
  is(mod.package.name, (await sl.findPackageJSON(fpath)).name)
  is(mod.source, (await fs.readFile(fpath)).toString())
  is(mod.resolutions.length, 2)
  ok(mod.resolutions.some((r) => r.output.includes('dep-a')))
  ok(mod.resolutions.some((r) => r.output.includes('dep-b')))
})

test('(esm) it throws converting esm -> cjs', async ({ exception }) => {
  const sl = scriptlinker()
  const fpath = unixresolve(__dirname, './fixtures/esm/index.js')
  const mod = await sl.load(fpath)
  exception(mod.toCJS.bind(mod))
})

test('(esm) it does not try to resolve custom protocol paths', async ({ is, ok }) => {
  const sl = scriptlinker()
  const fpath = unixresolve(__dirname, './fixtures/esm-custom-scheme/index.js')
  const mod = await sl.load(fpath)
  is(mod.resolutions.length, 8)
  const esm = await mod.toESM()
  const lines = esm.split('\n').filter(Boolean)
  is(
    lines.slice(0, lines.length - 1).join('\n'), // same source as file, sans sourceURL
    (await fs.readFile(fpath)).toString()
  )
})

function scriptlinker () {
  return new ScriptLinker({
    readFile: fs.readFile,
    stat: fs.stat,
    isFile (path) {
      return fs.stat(path).then((s) => s.isFile(), () => false)
    },
    isDirectory (path) {
      return fs.stat(path).then((s) => s.isDirectory(), () => false)
    }
  })
}
