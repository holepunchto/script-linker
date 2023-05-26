const path = require('path')
const crypto = require('crypto')
const test = require('brittle')
const { create } = require('./helpers/index.js')

const NO_PKG_PATH = path.join(`/${crypto.randomBytes(32).toString('hex')}/${crypto.randomBytes(32).toString('hex')}/`)
const CJS_MALFORMED_PATH = '/fixtures/cjs-malformed-package-json'
const ESM_MALFORMED_PATH = '/fixtures/esm-malformed-package-json'

test('it returns null if no package.json on the path', async ({ is }) => {
  const linker = create(__dirname)
  is(null, await linker.readPackageJSON(NO_PKG_PATH))
})

test('it returns null for malformed package.json (cjs)', async ({ exception }) => {
  const linker = create(__dirname)

  const jsonf = linker.readPackageJSON(path.join(CJS_MALFORMED_PATH, 'package.json'))
  await exception.all(async () => await jsonf, /Unexpected end of JSON input/)

  const jsond = linker.readPackageJSON(CJS_MALFORMED_PATH, { directory: true })
  await exception.all(async () => await jsond, /Unexpected end of JSON input/)
})

test('it returns null for malformed package.json (esm)', async ({ exception }) => {
  const linker = create(__dirname)

  const jsonf = linker.readPackageJSON(path.join(ESM_MALFORMED_PATH, 'package.json'))
  await exception.all(async () => await jsonf, /Unexpected end of JSON input/)

  const jsond = linker.readPackageJSON(ESM_MALFORMED_PATH, { directory: true })
  await exception.all(async () => await jsond, /Unexpected end of JSON input/)
})

test('load a malformed package.json (cjs)', async ({ ok, exception }) => {
  const linker = create(__dirname)

  const mod = await linker.load(path.join(CJS_MALFORMED_PATH, 'package.json'))
  await exception.all(async () => JSON.parse(await mod.toCJS()), /Unexpected end of JSON input/)

  try {
    JSON.parse(await mod.toCJS())
  } catch (err) {
    ok(err.message.includes('Unexpected end of JSON input'))
  }
})

test('load a malformed package.json (esm)', async ({ exception }) => {
  const linker = create(__dirname)

  const mod = await linker.load(path.join(ESM_MALFORMED_PATH, 'package.json'))
  await exception.all(async () => JSON.parse(await mod.toESM()), /Unexpected token c in JSON at position 0/)
})

test('load a module with a malformed package.json (cjs)', async ({ is }) => {
  const linker = create(__dirname)

  const mod = await linker.load(path.join(CJS_MALFORMED_PATH, 'index.js'))
  is(mod.packageMalformed, true)

  const src = await mod.toCJS()
  is(eval(src)(), 'malformed') // eslint-disable-line
})

test('load a module with a malformed package.json (esm)', async ({ is, exception }) => {
  const linker = create(__dirname)

  const mod = await linker.load(path.join(ESM_MALFORMED_PATH, 'index.js'))
  is(mod.packageMalformed, true)

  await exception.all(async () => await mod.toESM(), /Invalid package config while importing \/fixtures\/esm-malformed-package-json\/index.js/)

  try {
    await mod.toESM()
  } catch (err) {
    is(err.code, 'ERR_INVALID_PACKAGE_CONFIG')
  }
})
