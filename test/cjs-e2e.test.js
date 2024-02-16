const test = require('brittle')
const path = require('path')
const ScriptLinker = require('../index.js')
const mod = require('module')
const fs = require('fs')

test('linker can createRequire', ({ is, fail, ok }) => {
  const resolve = path.join(__dirname, './fixtures/cjs-with-exports/index.js')

  const opts = {
    resolveSync (request, basedir) {
      ok(request.startsWith('./fixtures/cjs-with-exports'))
      return resolve
    },
    getSync (request) {
      is(request.replaceAll('%5C', '\\'), 'app://cjs' + resolve)
      return fs.readFileSync(resolve).toString()
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myRequire = runtime.createRequire(__dirname)
  is(myRequire('./fixtures/cjs-with-exports'), 'an export')
  is(myRequire('./fixtures/cjs-with-exports/index.js'), 'an export')
})

test('map should be able to rewrite urls', ({ is, ok, not, teardown }) => {
  let original = null
  let xformed = null

  const opts = {
    getSync (url) {
      ok(url.includes('cjs-with-imports-and-exports'))
      if (!xformed) xformed = url
      return fs.readFileSync(url).toString()
    },
    resolveSync (request, basedir) {
      if (request === './test/fixtures/cjs-with-exports') return path.join(basedir, request, 'index.js')
      else return path.join(basedir, request)
    },
    map (x) {
      if (!original) original = x
      return x.replace('cjs-with-exports', 'cjs-with-imports-and-exports')
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myRequire = runtime.createRequire(path.join(__dirname))
  not(myRequire('./test/fixtures/cjs-with-exports'), 'an export')
  is(myRequire('./test/fixtures/cjs-with-exports')(0), 1)
  is(xformed.replace('cjs-with-imports-and-exports', 'cjs-with-exports'), original)
})

test('by default it should resolve builtin modules', ({ is, ok, fail, teardown }) => {
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
  const fs1 = ScriptLinker.runtime(opts).createRequire('/')('fs')
  ok(fs1)
})

test('it should allow custom builtin module resolution', ({ is, fail, teardown, exception }) => {
  const opts = {
    resolveSync (...args) {
      if (args[0] === 'fs') throw new Error('err on fs')
    },
    getSync () { fail('never should be called') },
    builtins: {
      has (x) {
        return x.includes('.js')
      },
      keys () { return [] }
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myRequire = runtime.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
  exception(() => myRequire('fs'))
})

test('it should support custom source compilation', ({ is, fail, teardown, exception }) => {
  const resolve = path.join(__dirname, './fixtures/cjs-with-exports/index.js')

  const opts = {
    getSync (url) {
      return fs.readFileSync(resolve).toString()
    },
    resolveSync (request, basedir) {
      return resolve
    },
    compile (...args) {
      const [source, ...rest] = args.reverse()
      const nargs = [...rest.reverse(), source.replace('an export', 'AN EXPORT')]
      return ScriptLinker.defaults.compile(...nargs)
    }
  }
  const runtime = ScriptLinker.runtime(opts)
  const myRequire = runtime.createRequire(path.join(__dirname, './fixtures/cjs-with-exports'))
  is(myRequire('./cjs-with-exports'), 'AN EXPORT')
})
