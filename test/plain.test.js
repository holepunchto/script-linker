const fs = require('fs/promises')
const path = require('path')
const { JSDOM } = require('jsdom')
const test = require('brittle')
const ScriptLinker = require('../')

test('it should load plain vanilla js modules', async ({ is }) => {
  const linker = new ScriptLinker({ readFile: fs.readFile })
  const mod = await linker.load(path.resolve(__dirname, '../node_modules/jquery/dist/jquery.js'))
  const esm = await mod.toESM()
  const runtime = ScriptLinker.runtime({
    resolveSync () { return `data:text/javascript,${encodeURIComponent(esm)}` },
    map (x) { return x }
  })
  const myImport = runtime.createImport(path.resolve(__dirname, '../node_modules/jquery'), (s) => import(s))
  const { default: $ } = await myImport('jquery')
  const dom = new JSDOM('<!DOCTYPE html><p id="message">It worked!</p>')
  const els = $(dom.window)('#message')
  is(els.length, 1)
})

test('resolve builtin module name correctly', async function (t) {
  const root = path.join(__dirname, './fixtures/require')
  const linker = new ScriptLinker({ readFile: (name) => fs.readFile(path.join(root, name)) })

  let first = null

  for await (const dep of linker.dependencies('/fs.js')) {
    if (!first) first = dep
  }

  // t.alike(first.module.resolutions, [ { isImport: false, position: null, input: 'fs', output: 'fs' } ])
  t.ok(first.module.resolutions.some(r => r.input === 'fs' && r.output === 'fs'))
})

test('resolve builtin module name correctly (slash added)', async function (t) {
  const root = path.join(__dirname, './fixtures/require')
  const linker = new ScriptLinker({ readFile: (name) => fs.readFile(path.join(root, name)) })

  let first = null

  for await (const dep of linker.dependencies('/fs-promises.js')) {
    if (!first) first = dep
  }

  // t.alike(first.module.resolutions, [ { isImport: false, position: null, input: 'fs/promises', output: 'fs/promises' } ])
  t.ok(first.module.resolutions.some(r => r.input === 'fs/promises' && r.output === 'fs/promises'))
})
