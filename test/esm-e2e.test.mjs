import test from 'brittle'
import path from 'path'
import ScriptLinker from '../index.js'
import mod from 'module'
import fs from 'fs/promises'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

test('linker can import', async ({ is, fail, ok }) => {
  const doImport = (x) => {
    return import(pathToFileURL(path.join(__dirname, './fixtures/esm-with-exports', 'index.js')).href)
  }

  const opts = {
    getSync (url) {
      return fs.readFileSync(url).toString()
    },
    resolveSync (request, basedir) {
      return path.join(basedir, request, 'index.js')
    }
  }

  const runtime = ScriptLinker.runtime(opts)
  const myImport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const { default: exp } = await myImport('./esm-with-exports/index.js')
  is(exp, 'an export')
})

test('map should be able to rewrite urls', async ({ is, ok, not, teardown }) => {
  let original = null
  let xformed = null

  const doImport = (url) => {
    if (!xformed) xformed = url
    return import(pathToFileURL(url).href)
  }

  const opts = {
    resolveSync (request, basedir) {
      return path.join(basedir, request, 'index.js')
    },
    map (x) {
      if (!original) original = x
      return x.replace('esm-with-exports', 'cjs-with-imports-and-exports')
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myImport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const { default: exp } = await myImport('./esm-with-exports')
  is(xformed.replace('cjs-with-imports-and-exports', 'esm-with-exports'), original)
  not(exp, 'an export')
})

test('by default it should resolve builtin modules', async ({ is, ok, fail, teardown }) => {
  const doImport = (x) => {
    return import('fs')
  }

  const opts = {
    builtins: {
      has (x) {
        return mod.builtinModules.includes(x)
      },
      get (x) {
        ok(x)
        return require(x)
      },
      keys () {
        return mod.builtinModules
      }
    },
    resolveSync () { fail('resolve: never should be called') },
    getSync () { fail('get: never should be called') }
  }
  const fs1 = await ScriptLinker.runtime(opts).createImport('/', doImport)('fs')
  ok(fs1)
})

test('it should allow custom builtin module resolution', async ({ is, fail, teardown, exception }) => {
  const doImport = (x) => {
    return import(pathToFileURL(path.join(__dirname, './fixtures/esm-with-exports', 'index.js')).href)
  }

  const opts = {
    resolveSync (request, basedir) {
      if (request === 'fs') throw new Error('err on fs')
      return path.join(basedir, request, 'index.js')
    },
    getSync () { fail('never should be called') },
    builtins: {
      has (x) {
        return x.includes('.js')
      },
      get () {
        return prerequired
      },
      keys () { return [] }
    }
  }
  const prerequire = ScriptLinker.runtime(opts).createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const prerequired = await prerequire('./esm-with-exports')
  const runtime = ScriptLinker.runtime(opts)
  const myImport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const imported = await myImport('./esm-with-exports')
  const { default: exp } = imported
  is(exp, 'an export')
  exception(() => myImport('fs'))
})

test('it should support custom source compilation', async ({ is, ok, teardown }) => {
  const opts = {
    getSync (url) {
      return fs.readFileSync(path.join(__dirname, './fixtures/esm-with-exports', 'index.js'))
    },
    resolveSync (request, basedir) {
      return path.join(basedir, request, 'index.js')
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myImport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), (r) => {
    return import('data:text/javascript,' + 'const c = "AN EXPORT"; export default c')
  })
  const { default: exp } = await myImport('./esm-with-exports')
  is(exp, 'AN EXPORT')
})
