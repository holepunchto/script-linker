const path = require('path')
const crypto = require('crypto')
const test = require('brittle')
const { create } = require('./helpers/index.js')

const NO_PKG_PATH = path.join(`/${crypto.randomBytes(32).toString('hex')}/${crypto.randomBytes(32).toString('hex')}/`)
const CJS_MALFORMED_PATH = '/fixtures/cjs-malformed-package-json'
const ESM_MALFORMED_PATH = '/fixtures/esm-malformed-package-json'

test('it returns null if no package.json on the path', async function (t) {
  const linker = create(__dirname)
  t.is(null, await linker.readPackageJSON(NO_PKG_PATH))
})

test('it returns null for malformed package.json (cjs)', async function (t) {
  const linker = create(__dirname)

  const jsonf = linker.readPackageJSON(path.join(CJS_MALFORMED_PATH, 'package.json'))
  await t.exception.all(async () => await jsonf)

  const jsond = linker.readPackageJSON(CJS_MALFORMED_PATH, { directory: true })
  await t.exception.all(async () => await jsond)
})

test('it returns null for malformed package.json (esm)', async function (t) {
  const linker = create(__dirname)

  const jsonf = linker.readPackageJSON(path.join(ESM_MALFORMED_PATH, 'package.json'))
  await t.exception.all(async () => await jsonf)

  const jsond = linker.readPackageJSON(ESM_MALFORMED_PATH, { directory: true })
  await t.exception.all(async () => await jsond)
})

test('load a malformed package.json (cjs)', async function (t) {
  const linker = create(__dirname)

  const mod = await linker.load(path.join(CJS_MALFORMED_PATH, 'package.json'))
  await t.exception.all(async () => JSON.parse(await mod.toCJS()))

  try {
    JSON.parse(await mod.toCJS())
  } catch (err) {
    t.pass('errored')
  }
})

test('load a malformed package.json (esm)', async function (t) {
  const linker = create(__dirname)

  const mod = await linker.load(path.join(ESM_MALFORMED_PATH, 'package.json'))
  await t.exception.all(async () => JSON.parse(await mod.toESM()))
})

test('load a module with a malformed package.json (cjs)', async function (t) {
  const linker = create(__dirname)

  const mod = await linker.load(path.join(CJS_MALFORMED_PATH, 'index.js'))
  t.is(mod.packageMalformed, true)

  const src = await mod.toCJS()
  t.is(eval(src)(), 'malformed') // eslint-disable-line
})

test('load a module with a malformed package.json (esm)', async function (t) {
  const linker = create(__dirname)

  const mod = await linker.load(path.join(ESM_MALFORMED_PATH, 'index.js'))
  t.is(mod.packageMalformed, true)

  await t.exception.all(async () => await mod.toESM(), /Invalid package config while importing \/fixtures\/esm-malformed-package-json\/index.js/)

  try {
    await mod.toESM()
  } catch (err) {
    t.is(err.code, 'INVALID_PACKAGE_CONFIG')
  }
})
