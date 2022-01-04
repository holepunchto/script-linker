// tests script linker with a custom fs interface
import test from 'brittle'
import ScriptLinker from '../index.js'
import fs from 'fs/promises'
import path from 'path'
import url from 'url'
import unixify from '../lib/unixify.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const dirasobj = await dir2obj(path.join(__dirname, 'fixtures'))
const scriptlinker = scriptlinkerFactory(dirasobj)

test('(cjs) it finds package.json by filename', async ({ is }) => {
  const sl = scriptlinker()
  const pj = await sl.findPackageJSON(path.resolve(__dirname, './fixtures/cjs/index.js'))
  is(pj.name, 'commonjs-app')
})

test('(cjs) it finds package.json by directory name', async ({ is }) => {
  const sl = scriptlinker()
  const pj = await sl.findPackageJSON(path.resolve(__dirname, './fixtures/cjs/'), { directory: true })
  is(pj.name, 'commonjs-app')
})

test('(cjs) it resolves module', async ({ is }) => {
  const sl = scriptlinker()
  const mpath = await sl.resolve(
    './fixtures/cjs/lib/dep-a.js',
    __dirname
  )
  is(mpath, unixify(path.resolve(__dirname, './fixtures/cjs/lib/dep-a.js')))
})

test('(cjs) it loads module', async ({ is, ok }) => {
  const sl = scriptlinker()
  const fpath = path.resolve(__dirname, './fixtures/cjs/index.js')
  const mod = await sl.load(fpath)
  is(mod.filename, unixify(fpath))
  is(mod.dirname, path.dirname(unixify(fpath)))
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
  const fpath = path.resolve(__dirname, './fixtures/cjs/index.js')
  const mod = await sl.load(fpath)
  const asESM = await mod.toESM()
  ok(asESM) // TODO write to disk and reimport
})

test('(cjs) it converts to JSON if .json', async ({ is }) => {
  const sl = scriptlinker()
  const fpath = path.resolve(__dirname, './fixtures/cjs/package.json')
  const mod = await sl.load(fpath)
  const json = await mod.toCJS()
  is(json, (await fs.readFile(fpath)).toString())
})

test('(esm) it finds package.json by filename', async ({ is }) => {
  const sl = scriptlinker()
  const pj = await sl.findPackageJSON(path.resolve(__dirname, './fixtures/esm/index.js'))
  is(pj.name, 'esm-app')
})

test('(esm) it finds package.json by directory name', async ({ is }) => {
  const sl = scriptlinker()
  const pj = await sl.findPackageJSON(path.resolve(__dirname, './fixtures/esm/'), { directory: true })
  is(pj.name, 'esm-app')
})

test('(esm) it resolves module', async ({ is }) => {
  const sl = scriptlinker()
  const mpath = await sl.resolve(
    './fixtures/esm/lib/dep-a.js',
    __dirname
  )
  is(mpath, unixify(path.resolve(__dirname, './fixtures/esm/lib/dep-a.js')))
})

test('(esm) it loads module', async ({ is, ok }) => {
  const sl = scriptlinker()
  const fpath = path.resolve(__dirname, './fixtures/esm/index.js')
  const mod = await sl.load(fpath)
  is(mod.filename, unixify(fpath))
  is(mod.dirname, path.dirname(unixify(fpath)))
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
  const fpath = path.resolve(__dirname, './fixtures/esm/index.js')
  const mod = await sl.load(fpath)
  exception(mod.toCJS.bind(mod))
})

test('(esm) it does not try to resolve custom protocol paths', async ({ is, ok }) => {
  const sl = scriptlinker()
  const fpath = path.resolve(__dirname, './fixtures/esm-custom-scheme/index.js')
  const mod = await sl.load(fpath)
  is(mod.resolutions.length, 0)
  const esm = await mod.toESM()
  const lines = esm.split('\n').filter(Boolean)
  is(
    lines.slice(0, lines.length - 1).join('\n'), // same source as file, sans sourceURL
    (await fs.readFile(fpath)).toString()
  )
})

function scriptlinkerFactory (o = {}) {
  return function () {
    return new ScriptLinker({
      readFile: readFile(o),
      isFile: isFile(o),
      isDirectory: isDirectory(o)
    })
  }
}

async function dir2obj (dirname, o = {}) {
  const ps = await fs.readdir(dirname)
  for (const p of ps) {
    const np = path.join(dirname, p)
    const stat = await fs.stat(np)
    if (stat.isDirectory()) await dir2obj(np, o) // mutates o
    else oset(o, unixify(np).split('/').filter(Boolean), (await fs.readFile(np)).toString())
  }
  return o
}

function readFile (o) {
  return async function (path) {
    return oget(o, unixify(path).split('/').filter(Boolean))
  }
}

function isFile (o) {
  return async function (path) {
    const r = await readFile(o)(path)
    if (typeof r === 'string') return true
  }
}

function isDirectory (o) {
  return async function (path) {
    return !(await isFile(o)(path))
  }
}

function oget (o, k) {
  for (let i = 0; i < k.length && o; i++) o = o[k[i]]
  return o
}

function oset (o, k, v) {
  for (let i = 0; i < k.length - 1 && o; i++) {
    if (!o[k[i]]) o[k[i]] = {}
    o = o[k[i]]
  }
  if (o) o[k[k.length - 1]] = v
  return o
}