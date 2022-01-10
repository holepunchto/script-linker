/* (in the matrix) this file is loaded by script-linker in worker */
import path from 'path'
import fs from 'fs/promises'
import mod from 'module'
import url from 'url'
import test from 'brittle'
import unixresolve from 'unix-path-resolve'
import ScriptLinker from '../index.js'

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const linker = global[Symbol.for('scriptlinker')]
const { _opts } = linker

const doImport = (x) => {
  return import(x)
}

test('linker should be on the global object', ({ ok }) => {
  ok(linker)
})

test('linker can createImport', async ({ is }) => {
  const myimport = linker.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const { default: exp } = await myimport('./esm-with-exports/index.js')
  is(exp, 'an export')
})

test('map should be able to rewrite urls', async ({ is, not, teardown }) => {
  teardown(() => { global[Symbol.for('scriptlinker')] = linker })
  let original = null
  const opts = {
    ..._opts,
    map (x) {
      if (!original) original = x
      return x.replace('esm-with-exports', 'cjs-with-imports-and-exports')
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myimport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const { default: exp } = await myimport('./esm-with-exports')
  not(exp, 'an export')
  is(exp(0), 1)
})

test('by default it should resolve builtin modules', async ({ is, ok, fail, teardown }) => {
  teardown(() => { global[Symbol.for('scriptlinker')] = linker })
  const opts = {
    ..._opts,
    builtins: {
      has (x) {
        return mod.builtinModules.includes(x)
      },
      get (x) {
        ok(x)
        return import(x)
      },
      keys () {
        return mod.builtinModules
      }
    },
    resolveSync () { fail('resolve: never should be called') },
    getSync () { fail('get: never should be called') }
  }
  const fs1 = await ScriptLinker.runtime(opts).createImport('/', doImport)('fs')
  const fs2 = await linker.createImport('/', doImport)('fs')
  is(fs1, fs2)
})

test('it should allow custom builtin module resolution', async ({ is, fail, teardown, exception }) => {
  teardown(() => { global[Symbol.for('scriptlinker')] = linker })
  const prerequire = linker.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const prerequired = await prerequire('./esm-with-exports')
  const opts = {
    ..._opts,
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
  const runtime = ScriptLinker.runtime(opts)
  const myimport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const imported = await myimport('./esm-with-exports')
  const { default: exp } = imported
  is(exp, 'an export')
  exception(() => myimport('fs'))
})

test('it should support custom source compilation', async ({ is, teardown }) => {
  teardown(() => { global[Symbol.for('scriptlinker')] = linker })
  const runtime = ScriptLinker.runtime(_opts)
  const myimport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), (r) => {
    return fs.readFile(r)
      .then((buf) => buf.toString())
      .then((src) => encodeURIComponent(src.replace('an export', 'AN EXPORT')))
      .then((src) => import('data:text/javascript,' + src))
  })
  const { default: exp } = await myimport('./esm-with-exports')
  is(exp, 'AN EXPORT')
})

test('it should support custom getSync (noop)', async ({ is, teardown, fail }) => {
  teardown(() => { global[Symbol.for('scriptlinker')] = linker })
  const opts = {
    ..._opts,
    getSync (fpath) {
      fail('never should be called')
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myimport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const { default: exp } = await myimport('./esm-with-exports')
  is(exp, 'an export')
})

test('it should support custom resolveSync', async ({ is, teardown }) => {
  teardown(() => { global[Symbol.for('scriptlinker')] = linker })
  const opts = {
    ..._opts,
    resolveSync (...args) {
      const [_, ...rest] = args.reverse() // eslint-disable-line
      return unixresolve(path.join(...rest.concat('index.js')))
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myimport = runtime.createImport(path.join(__dirname, './fixtures/esm-with-exports'), doImport)
  const { default: exp } = await myimport('./esm-with-exports')
  is(exp, 'an export')
})
