// tests script linker with node fs interface
import test from 'brittle'
import fs from 'fs/promises'
import path from 'path'
import url from 'url'
import unixresolve from 'unix-path-resolve'
import { Module } from 'module'
import { create } from './helpers/index.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

test('it resolves builtins', async ({ is }) => {
  const sl = create()
  const mpath = await sl.resolve('events')
  is(mpath, 'events')
})

test('it loads builtins', async ({ is }) => {
  const sl = create()
  const mod = await sl.load('events')
  is(mod.filename, 'events')
  is(mod.dirname, '/')
  is(mod.builtin, true)
  is(mod.type, 'module')
  is(mod.package, null)
  is(mod.source.trim(), (`
const __mod__ = global[Symbol.for('scriptlinker')].require("events")
export const once = __mod__.once
export const on = __mod__.on
export const getEventListeners = __mod__.getEventListeners
export const EventEmitter = __mod__.EventEmitter
export const usingDomains = __mod__.usingDomains
export const captureRejectionSymbol = __mod__.captureRejectionSymbol
export const captureRejections = __mod__.captureRejections
export const EventEmitterAsyncResource = __mod__.EventEmitterAsyncResource
export const errorMonitor = __mod__.errorMonitor
export const defaultMaxListeners = __mod__.defaultMaxListeners
export const setMaxListeners = __mod__.setMaxListeners
export const init = __mod__.init
export const listenerCount = __mod__.listenerCount
export default __mod__
  `).trim())
  // domain mutually exclusive w brittle through uncaught exception capture callback registration,
  // repl mutually exclusive w brittle through domain
  for (const modName of Module.builtinModules.filter((name) => !(['domain', 'repl']).includes(name))) is((await sl.load(modName)).filename, modName)
})

test('(cjs) it finds package.json by filename', async ({ is }) => {
  const sl = create(__dirname)
  const pj = await sl.readPackageJSON('/fixtures/cjs/index.js')
  is(pj.name, 'commonjs-app')
})

test('(cjs) it finds package.json by directory name', async ({ is }) => {
  const sl = create(__dirname)
  const pj = await sl.readPackageJSON('/fixtures/cjs/', { directory: true })
  is(pj.name, 'commonjs-app')
})

// TODO: review
test('(cjs) it resolves modules', async ({ is }) => {
  const sl = create(__dirname)
  const mpath = await sl.resolve('/fixtures/cjs/lib/dep-a.js', '/')
  is(mpath, '/fixtures/cjs/lib/dep-a.js')
})

// TODO: review
test('(cjs) it loads module', async ({ is, ok }) => {
  const sl = create(__dirname)
  const fpath = '/fixtures/cjs/index.js'
  const mod = await sl.load(fpath)
  is(mod.filename, fpath)
  is(mod.dirname, unixresolve(fpath, '..'))
  is(mod.builtin, false)
  is(mod.type, 'commonjs')
  is(mod.package.name, (await sl.readPackageJSON(fpath)).name)
  is(mod.name, mod.package.name)
  is(mod.source, (await fs.readFile(unixresolve(__dirname, './fixtures/cjs/index.js'))).toString())
  is(mod.resolutions.length, 2)
  ok(mod.resolutions.some((r) => r.output.includes('dep-a')))
  ok(mod.resolutions.some((r) => r.output.includes('dep-b')))
})

test('(cjs) it converts to ESM', async ({ ok }) => {
  const sl = create(__dirname)
  const fpath = '/fixtures/cjs/index.js'
  const mod = await sl.load(fpath)
  const asESM = await mod.toESM()
  ok(asESM) // TODO write to disk and reimport
})

test('(cjs) it converts to JSON if .json', async ({ is }) => {
  const sl = create(__dirname)
  const fpath = '/fixtures/cjs/package.json'
  const mod = await sl.load(fpath)
  const json = await mod.toCJS()
  is(json, (await fs.readFile(unixresolve(__dirname, './fixtures/cjs/package.json'))).toString())
})

test('(esm) it finds package.json by filename', async ({ is }) => {
  const sl = create(__dirname)
  const pj = await sl.readPackageJSON('/fixtures/esm/index.js')
  is(pj.name, 'esm-app')
})

test('(esm) it finds package.json by directory name', async ({ is }) => {
  const sl = create(__dirname)
  const pj = await sl.readPackageJSON('/fixtures/esm/', { directory: true })
  is(pj.name, 'esm-app')
})

test('(esm) it resolves module', async ({ is }) => {
  const sl = create(__dirname)
  const mpath = await sl.resolve('/fixtures/esm/lib/dep-a.js', '/')
  is(mpath, '/fixtures/esm/lib/dep-a.js')
})

test('(esm) it loads module', async ({ is, ok }) => {
  const sl = create(__dirname)
  const fpath = '/fixtures/esm/index.js'
  const mod = await sl.load(fpath)
  is(mod.filename, fpath)
  is(mod.dirname, path.dirname(fpath))
  is(mod.builtin, false)
  is(mod.type, 'module')
  is(mod.package.name, (await sl.readPackageJSON(fpath)).name)
  is(mod.source, (await fs.readFile(unixresolve(__dirname, './fixtures/esm/index.js'))).toString())
  is(mod.resolutions.length, 2)
  ok(mod.resolutions.some((r) => r.output.includes('dep-a')))
  ok(mod.resolutions.some((r) => r.output.includes('dep-b')))
})

test('(esm) it throws converting esm -> cjs', async ({ exception }) => {
  const sl = create(__dirname)
  const fpath = '/fixtures/esm/index.js'
  const mod = await sl.load(fpath)
  exception(mod.toCJS.bind(mod))
})

test('(esm) it does not try to resolve custom protocol paths', async ({ is, ok }) => {
  const sl = create(__dirname)
  const fpath = '/fixtures/esm-custom-scheme/index.js'
  const mod = await sl.load(fpath)
  is(mod.resolutions.length, 8, 'fixture has 8 custom protocols')
  const esm = await mod.toESM()
  const lines = esm.split('\n').filter(Boolean)
  is(
    lines.slice(0, lines.length - 1).join('\n'), // same source as file, sans sourceURL
    (await fs.readFile(unixresolve(__dirname, './fixtures/esm-custom-scheme/index.js'))).toString()
  )
})
