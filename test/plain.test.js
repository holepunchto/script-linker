const { readFileSync } = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const test = require('brittle')
const { create } = require('./helpers/index.js')
const ScriptLinker = require('../')

test('it should load plain vanilla js modules', async function (t) {
  const root = path.resolve(__dirname, '../node_modules')
  const linker = create(root)

  const mod = await linker.load('/jquery/dist/jquery.js')
  const esm = await mod.toESM()
  const runtime = ScriptLinker.runtime({
    resolveSync () { return `data:text/javascript,${encodeURIComponent(esm)}` },
    getSync (name) { return readFileSync(path.resolve(root, '.' + name), 'utf-8') },
    map (x) { return x }
  })
  const myImport = runtime.createImport(path.resolve(__dirname, '../node_modules/jquery'), (s) => import(s))

  const { default: $ } = await myImport('jquery')
  const dom = new JSDOM('<!DOCTYPE html><p id="message">It worked!</p>')
  const els = $(dom.window)('#message')
  t.is(els.length, 1)
})

test('resolve builtin module name correctly', async function (t) {
  const linker = create(path.join(__dirname, './fixtures/require'))

  let first = null
  for await (const dep of linker.dependencies('/fs.js')) {
    if (!first) first = dep
  }
  t.alike(first.module.resolutions, [{ isImport: false, position: null, input: 'fs', output: 'fs' }])
})

test('resolve builtin module name correctly (slash added)', async function (t) {
  const linker = create(path.join(__dirname, './fixtures/require'))

  let first = null
  for await (const dep of linker.dependencies('/fs-promises.js')) {
    if (!first) first = dep
  }
  t.alike(first.module.resolutions, [{ isImport: false, position: null, input: 'fs/promises', output: 'fs/promises' }])
})
