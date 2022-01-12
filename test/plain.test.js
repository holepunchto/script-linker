const fs = require('fs/promises')
const path = require('path')
const { JSDOM } = require('jsdom')
const test = require('brittle')

test('it should load plain vanilla js modules', async ({ is }) => {
  const ScriptLinker = require('../')
  const linker = new ScriptLinker({ readFile: fs.readFile })
  const mod = await linker.load(path.resolve(__dirname, '../node_modules/jquery/dist/jquery.js'))
  const esm = await mod.toESM()
  const runtime = ScriptLinker.runtime({
    resolveSync() { return `data:text/javascript,${encodeURIComponent(esm)}` },
    map (x) { return x }
  })
  const myImport = runtime.createImport(path.resolve(__dirname, '../node_modules/jquery'), (s) => import(s))
  const { default: $ } = await myImport('jquery')
  const dom = new JSDOM(`<!DOCTYPE html><p id="message">It worked!</p>`)
  const els = $(dom.window)('#message')
  is(els.length, 1)
})
