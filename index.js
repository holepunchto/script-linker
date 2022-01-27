const resolveModule = require('resolve')
const b4a = require('b4a')
const unixresolve = require('unix-path-resolve')
const em = require('exports-map')
const Xcache = require('xache')
const Mod = require('./lib/module')
const bundle = require('./lib/bundle')
const d = require('./defaults')
const runtime = require('./runtime')
const link = require('./link')

class ScriptLinker {
  constructor ({
    map = d.map,
    mapImport = d.mapImport,
    builtins = d.builtins,
    linkSourceMaps = d.linkSourceMaps,
    defaultType = d.type,
    cacheSize = d.cacheSize,
    symbol = d.symbol,
    protocol = d.protocol,
    runtimes = ['node'],
    bare = false,
    stat,
    readFile,
    isFile,
    isDirectory
  }) {
    this.map = map
    this.mapImport = mapImport
    this.modules = new Xcache({ maxSize: cacheSize })
    this.builtins = builtins
    this.linkSourceMaps = linkSourceMaps
    this.defaultType = defaultType
    this.symbol = symbol
    this.protocol = protocol
    this.bare = bare

    this._importRuntimes = new Set(['import', ...runtimes])
    this._requireRuntimes = new Set(['require', ...runtimes])
    this._ns = bare ? '' : 'global[Symbol.for(\'' + symbol + '\')].'
    this._userStat = stat || null
    this._userReadFile = readFile || null
    this._userIsFile = isFile || null
    this._userIsDirectory = isDirectory || null
  }

  _isFile (name, cb) {
    if (this._userIsFile) {
      this._userIsFile(name).then((yes) => cb(null, yes), cb)
    } else {
      this._userReadFile(name).then(() => cb(null, true), () => cb(null, false))
    }
  }

  _isDirectory (name, cb) {
    if (this._userIsDirectory) {
      this._userIsDirectory(name).then((yes) => cb(null, yes), cb)
    } else {
      this._userReadFile(name).then(() => cb(null, false), () => cb(null, true))
    }
  }

  _readFile (name, cb) {
    this._userReadFile(name).then((buf) => cb(null, buf), cb)
  }

  _mapImportPostResolve (id) {
    if (isCustomScheme(id)) return id
    return this.map(id, {
      protocol: this.protocol,
      isImport: true,
      isBuiltin: this.builtins.has(id),
      isSourceMap: false,
      isConsole: false
    })
  }

  async findPackageJSON (filename, { directory = false } = {}) {
    let dirname = directory ? unixresolve(filename) : unixresolve(filename, '..')
    while (true) {
      let src = null
      try {
        src = await this._userReadFile(unixresolve(dirname, 'package.json'))
      } catch {
        if (dirname === '/') return null
        const next = unixresolve(dirname, '..')
        dirname = next
      }
      if (src !== null) return JSON.parse(typeof src === 'string' ? src : b4a.from(src))
    }
  }

  async * dependencies (filename, opts, visited = new Set(), modules = new Map(), type = null) {
    const m = modules.get(filename) || await this.load(filename, opts)
    modules.set(filename, m)

    const isImport = (type || m.type) === 'module'
    const id = (isImport ? 'i' : 'c') + filename

    if (visited.has(id)) return
    visited.add(id)

    yield { isImport, module: m }

    for (const r of m.resolutions) {
      if (r.output) yield * this.dependencies(r.output, opts, visited, modules, r.isImport ? 'module' : 'commonjs')
    }
  }

  async load (filename, opts) {
    let m = this.modules.get(filename)

    if (m) {
      await m.refresh()
      return m
    }

    m = new Mod(this, filename, opts)
    this.modules.set(m.filename, m)

    try {
      await m.refresh()
      return m
    } catch (err) {
      this.modules.delete(m.filename)
      throw err
    }
  }

  async transform ({ isSourceMap, isImport, transform = isImport ? 'esm' : isSourceMap ? 'map' : 'cjs', filename, resolve, dirname }) {
    if (!filename) filename = await this.resolve(resolve, dirname)

    const mod = await this.load(filename)

    if (transform === 'map') return mod.generateSourceMap()
    if (transform === 'esm') return mod.toESM()
    if (transform === 'cjs') return mod.toCJS()

    return mod.source
  }

  async resolve (req, basedir, { transform = 'esm', isImport = transform === 'esm' } = {}) {
    if (isImport) {
      req = this.mapImport(req, basedir)
      if (isCustomScheme(req)) return req
    }

    if (this.builtins.has(req)) return req

    const self = this
    const runtimes = isImport ? this._importRuntimes : this._requireRuntimes

    return new Promise((resolve, reject) => {
      resolveModule(req, {
        basedir,
        extensions: ['.js', '.mjs', '.cjs'],
        realpath (name, cb) {
          cb(null, name)
        },
        isFile: (name, cb) => {
          self._isFile(name, cb)
        },
        isDirectory: (name, cb) => {
          self._isDirectory(name, cb)
        },
        readFile: (name, cb) => {
          self._readFile(name, cb)
        },
        packageFilter (pkg) {
          if (!pkg.exports) return pkg

          const main = em(pkg.exports, runtimes, '.')
          if (main) pkg.main = main

          return pkg
        },
        pathFilter (pkg, path, rel) {
          if (!pkg.exports) return rel

          // We should actually error, if the path doesn't resolve, but resolve cannot to do that
          return em(pkg.exports, runtimes, '.' + unixresolve('/', rel)) || rel
        }
      }, function (err, res) {
        if (err) return reject(err)
        resolve(unixresolve(res))
      })
    })
  }

  async bundle (filename, opts) {
    return bundle(this, filename, opts)
  }

  static runtime (opts) {
    return runtime(opts)
  }
}

ScriptLinker.defaults = d
ScriptLinker.link = link

module.exports = ScriptLinker

function isCustomScheme (str) {
  return /^[a-z][a-z0-9]+:/i.test(str)
}
