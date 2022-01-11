/* (in the matrix) this file is loaded by script-linker in worker */

const path = require('path')
const test = require('brittle')
const fs = require('fs')
const mod = require('module')
const ScriptLinker = require('../')

if (!require('worker_threads').isMainThread) {
  const linker = global[Symbol.for('scriptlinker')]
  const { _opts } = linker

  test('linker should be on the global object', ({ ok }) => {
    ok(linker)
  })

  test('linker can createRequire', ({ is }) => {
    const myRequire = linker.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
    is(myRequire('./cjs-with-exports'), 'an export')
    is(myRequire('./cjs-with-exports/index.js'), 'an export')
  })

  test('map should be able to rewrite urls', ({ is, not, teardown }) => {
    teardown(() => { global[Symbol.for('scriptlinker')] = linker })
    let original = null
    let xformed = null
    const opts = {
      ..._opts,
      getSync (url) {
        if (!xformed) xformed = url
        return _opts.getSync(url)
      },
      map (x) {
        if (!original) original = x
        return x.replace('cjs-with-exports', 'cjs-with-imports-and-exports')
      }
    }
    const runtime = ScriptLinker.runtime(opts)
    const myRequire = runtime.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
    not(myRequire('./cjs-with-exports'), 'an export')
    is(myRequire('./cjs-with-exports')(0), 1)
    is(xformed.replace('cjs-with-imports-and-exports', 'cjs-with-exports'), original)
  })

  test('by default it should resolve builtin modules', ({ is, ok, fail, teardown }) => {
    teardown(() => { global[Symbol.for('scriptlinker')] = linker })
    const opts = {
      ..._opts,
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
    const fs1 = ScriptLinker.runtime(opts).createRequire('/')('fs')
    const fs2 = linker.createRequire('/')('fs')
    is(fs1, fs2)
  })

  test('it should allow custom builtin module resolution', ({ is, fail, teardown, exception }) => {
    teardown(() => { global[Symbol.for('scriptlinker')] = linker })
    const prerequire = linker.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
    const prerequired = prerequire('./cjs-with-exports')
    const opts = {
      ..._opts,
      resolveSync (...args) {
        if (args[0] === 'fs') throw new Error('err on fs')
        return _opts.resolveSync(...args)
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
    const runtime = ScriptLinker.runtime(opts)
    const myRequire = runtime.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
    is(myRequire('./cjs-with-exports'), 'an export')
    exception(() => myRequire('fs'))
  })

  test('it should support custom source compilation', ({ is, fail, teardown, exception }) => {
    teardown(() => { global[Symbol.for('scriptlinker')] = linker })
    const opts = {
      ..._opts,
      compile (...args) {
        const [source, ...rest] = args.reverse()
        const nargs = [...rest.reverse(), source.replace('an export', 'AN EXPORT')]
        return ScriptLinker.defaultCompile(...nargs)
      }
    }
    const runtime = ScriptLinker.runtime(opts)
    const myRequire = runtime.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
    is(myRequire('./cjs-with-exports'), 'AN EXPORT')
  })

  test('it should support custom getSync', ({ is, teardown }) => {
    teardown(() => { global[Symbol.for('scriptlinker')] = linker })
    const opts = {
      ..._opts,
      getSync (fpath) {
        return fs.readFileSync(fpath).toString()
      }
    }
    const runtime = ScriptLinker.runtime(opts)
    const myRequire = runtime.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
    is(myRequire('./cjs-with-exports'), 'an export')
  })

  test('it should support custom resolveSync', ({ is, teardown }) => {
    teardown(() => { global[Symbol.for('scriptlinker')] = linker })
    const opts = {
      ..._opts,
      resolveSync (...args) {
        const [_, ...rest] = args.reverse() // eslint-disable-line
        return require.resolve(path.join(...rest))
      }
    }
    const runtime = ScriptLinker.runtime(opts)
    const myRequire = runtime.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
    is(myRequire('./cjs-with-exports'), 'an export')
  })
}
