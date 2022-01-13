const path = require('path')
const fs = require('fs/promises')
const test = require('brittle')
const ScriptLinker = require('../')
const { ok } = require('assert')

const CJS_MALFORMED_PATH = path.join(__dirname, './fixtures/cjs-malformed-package-json')
const ESM_MALFORMED_PATH = path.join(__dirname, './fixtures/esm-malformed-package-json')

test('it returns null for malformed package.json (cjs)', async ({ is }) => {
  const linker = new ScriptLinker({ readFile: fs.readFile })
  const jsonf = await linker.findPackageJSON(path.join(CJS_MALFORMED_PATH, 'package.json'))
  const jsond = await linker.findPackageJSON(CJS_MALFORMED_PATH, { directory: true })
  is(null, jsonf)
  is(jsonf, jsond)
})

test('it returns null for malformed package.json (cjs)', async ({ is }) => {
  const linker = new ScriptLinker({ readFile: fs.readFile })
  const jsonf = await linker.findPackageJSON(path.join(ESM_MALFORMED_PATH, 'package.json'))
  const jsond = await linker.findPackageJSON(ESM_MALFORMED_PATH, { directory: true })
  is(null, jsonf)
  is(jsonf, jsond)
})

test('load a malformed package.json (cjs)', async ({ is, exception }) => {
  const linker = new ScriptLinker({ readFile: fs.readFile })
  const mod = await linker.load(path.join(CJS_MALFORMED_PATH, 'package.json'))
  is(mod.malformedPackageJSON, true)
  exception.all(async () => JSON.parse(await mod.toCJS()))
  try {
    JSON.parse(await mod.toCJS())
  } catch (err) {
    ok(err.message.includes('Unexpected end of JSON input'))
  }
})

test('load a malformed package.json (esm)', async ({ is, exception }) => {
  const linker = new ScriptLinker({ readFile: fs.readFile })
  const mod = await linker.load(path.join(ESM_MALFORMED_PATH, 'package.json'))
  is(mod.malformedPackageJSON, true)
  exception.all(async () => JSON.parse(await mod.toESM()))
  try {
    await mod.toESM()
  } catch (err) {
    is(err.code, 'ERR_UNKNOWN_FILE_EXTENSION')
  }
})

test('load a module with a malformed package.json (cjs)', async ({ is, exception }) => {
  const linker = new ScriptLinker({ readFile: fs.readFile })
  const mod = await linker.load(path.join(CJS_MALFORMED_PATH, 'index.js'))
  is(mod.malformedPackageJSON, true)
  const src = await mod.toCJS()
  is(eval(src)(), 'malformed') // eslint-disable-line
})

test('load a module with a malformed package.json (esm)', async ({ is, exception }) => {
  const linker = new ScriptLinker({ readFile: fs.readFile })
  const mod = await linker.load(path.join(ESM_MALFORMED_PATH, 'index.js'))
  is(mod.malformedPackageJSON, true)
  exception.all(async () => await mod.toESM())
  try {
    await mod.toESM()
  } catch (err) {
    is(err.code, 'ERR_INVALID_PACKAGE_CONFIG')
  }
})
