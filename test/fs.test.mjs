// tests script linker with node fs interface
import test from 'brittle'
import fs from 'fs/promises'
import path from 'path'
import url from 'url'
import unixresolve from 'unix-path-resolve'
import { Module } from 'module'
import { create } from './helpers/index.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

test('it resolves builtins', async function (t) {
  const sl = create()
  const mpath = await sl.resolve('events')
  t.is(mpath, 'events')
})

test('it loads builtins', async function (t) {
  const sl = create()

  const mod = await sl.load('events')
  t.is(mod.filename, 'events')
  t.is(mod.dirname, '/')
  t.is(mod.builtin, true)
  t.is(mod.type, 'module')
  t.is(mod.package, null)
  // snifff for a couple of exports
  t.ok(/export const getEventListeners =/.test(mod.source.trim()))
  t.ok(/export const EventEmitter =/.test(mod.source.trim()))

  // domain mutually exclusive w brittle through uncaught exception capture callback registration,
  // repl mutually exclusive w brittle through domain
  const mods = Module.builtinModules.filter((name) => !(['domain', 'repl']).includes(name))
  for (const name of mods) {
    t.is((await sl.load(name)).filename, name)
  }
})

test('(cjs) it finds package.json by filename', async function (t) {
  const sl = create(__dirname)
  const pj = await sl.readPackageJSON('/fixtures/cjs/index.js')
  t.is(pj.name, 'commonjs-app')
})

test('(cjs) it finds package.json by directory name', async function (t) {
  const sl = create(__dirname)
  const pj = await sl.readPackageJSON('/fixtures/cjs/', { directory: true })
  t.is(pj.name, 'commonjs-app')
})

test('(cjs) it resolves modules', async function (t) {
  const sl = create(__dirname)
  const mpath = await sl.resolve('/fixtures/cjs/lib/dep-a.js', '/')
  t.is(mpath, '/fixtures/cjs/lib/dep-a.js')
})

test('(cjs) it loads module', async function (t) {
  const sl = create(__dirname)

  const filename = '/fixtures/cjs/index.js'
  const filepath = unixresolve(__dirname, '.' + filename)

  const mod = await sl.load(filename)
  t.is(mod.filename, filename)
  t.is(mod.dirname, unixresolve(filename, '..'))
  t.is(mod.builtin, false)
  t.is(mod.type, 'commonjs')
  t.is(mod.package.name, (await sl.readPackageJSON(filename)).name)
  t.is(mod.name, mod.package.name)
  t.is(mod.source, ((await fs.readFile(filepath)).toString()))
  t.is(mod.resolutions.length, 2)
  t.ok(mod.resolutions.some((r) => r.output.includes('dep-a')))
  t.ok(mod.resolutions.some((r) => r.output.includes('dep-b')))
})

test('(cjs) it converts to ESM', async function (t) {
  const sl = create(__dirname)
  const mod = await sl.load('/fixtures/cjs/index.js')
  const asESM = await mod.toESM()
  t.ok(asESM) // TODO write to disk and reimport
})

test('(cjs) it converts to JSON if .json', async function (t) {
  const sl = create(__dirname)
  const mod = await sl.load('/fixtures/cjs/package.json')
  const json = await mod.toCJS()
  t.is(json, (await fs.readFile(unixresolve(__dirname, './fixtures/cjs/package.json'))).toString())
})

test('(esm) it finds package.json by filename', async function (t) {
  const sl = create(__dirname)
  const pj = await sl.readPackageJSON('/fixtures/esm/index.js')
  t.is(pj.name, 'esm-app')
})

test('(esm) it finds package.json by directory name', async function (t) {
  const sl = create(__dirname)
  const pj = await sl.readPackageJSON('/fixtures/esm/', { directory: true })
  t.is(pj.name, 'esm-app')
})

test('(esm) it resolves module', async function (t) {
  const sl = create(__dirname)
  const mpath = await sl.resolve('/fixtures/esm/lib/dep-a.js', '/')
  t.is(mpath, '/fixtures/esm/lib/dep-a.js')
})

test('(esm) it loads module', async function (t) {
  const sl = create(__dirname)

  const filename = '/fixtures/esm/index.js'

  const mod = await sl.load(filename)
  t.is(mod.filename, filename)
  t.is(mod.dirname, path.dirname(filename))
  t.is(mod.builtin, false)
  t.is(mod.type, 'module')
  t.is(mod.package.name, (await sl.readPackageJSON(filename)).name)
  t.is(mod.source, (await fs.readFile(unixresolve(__dirname, './fixtures/esm/index.js'))).toString())
  t.is(mod.resolutions.length, 2)
  t.ok(mod.resolutions.some((r) => r.output.includes('dep-a')))
  t.ok(mod.resolutions.some((r) => r.output.includes('dep-b')))
})

test('(esm) it throws converting esm -> cjs', async function (t) {
  const sl = create(__dirname)
  const mod = await sl.load('/fixtures/esm/index.js')
  t.exception(mod.toCJS.bind(mod))
})

test('(esm) it does not try to resolve custom protocol paths', async function (t) {
  const sl = create(__dirname)

  const filename = '/fixtures/esm-custom-scheme/index.js'
  const filepath = unixresolve(__dirname, './fixtures/esm-custom-scheme/index.js')

  const mod = await sl.load(filename)
  t.is(mod.resolutions.length, 8, 'fixture has 8 custom protocols')

  const esm = await mod.toESM()
  const lines = esm.split('\n').filter(Boolean)
  t.is(
    lines.slice(0, lines.length - 1).join('\n'), // same source as file, sans sourceURL
    (await fs.readFile(filepath)).toString()
  )
})
