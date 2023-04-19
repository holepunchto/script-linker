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
    mapResolve = null,
    mapPath = d.mapPath,
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
    this.mapResolve = mapResolve
    this.mapPath = mapPath
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

  async _isFile (name) {
    if (this._userIsFile) return this._userIsFile(name)
    try {
      await this._userReadFile(name)
      return true
    } catch {
      return false
    }
  }

  async _isDirectory (name) {
    if (this._userIsDirectory) return this._userIsDirectory(name)
    try {
      await this._userReadFile(name)
      return false
    } catch {
      return true
    }
  }

  _readFile (name) {
    return this._userReadFile(name)
  }

  _mapImportPostResolve (req, basedir) {
    req = this.mapImport(req, basedir)
    if (isCustomScheme(req)) return req
    return this.map(req, {
      protocol: this.protocol,
      isImport: true,
      isBuiltin: this.builtins.has(req),
      isSourceMap: false,
      isConsole: false
    })
  }

  async resolvePackageJSON (filename, { directory = false } = {}) {
    let dirname = directory ? unixresolve(filename) : unixresolve(filename, '..')
    while (true) {
      const pkg = unixresolve(dirname, 'package.json')
      if (await this._isFile(pkg)) return pkg
      if (dirname === '/') return null
      const next = unixresolve(dirname, '..')
      dirname = next
    }
  }

  async readPackageJSON (filename, { directory = false } = {}) {
    let src
    try {
      const pkg = await this.resolvePackageJSON(filename, { directory })
      if (pkg === null) return null
      src = await this._readFile(pkg)
    } catch {
      return null
    }
    return JSON.parse(typeof src === 'string' ? src : b4a.from(src))
  }

  async * dependencies (filename, opts, visited = new Set(), modules = new Map(), type = null) {
    if (Array.isArray(filename)) {
      for (const f of filename) yield * this.dependencies(f, opts, visited, modules, type)
      return
    }

    if (isCustomScheme(filename)) return
    if (opts && opts.filter && !opts.filter(filename)) return

    if (filename.endsWith('.html')) {
      const src = await this._userReadFile(filename)
      const entries = sniffJS(b4a.toString(src)) // could be improved to sniff custom urls also
      const dir = unixresolve(filename, '..')

      for (const entry of entries) {
        try {
          yield * this.dependencies(unixresolve(dir, entry), opts, visited, modules, null)
        } catch {
          continue // prob just an invalid js file we hit
        }
      }

      return
    }

    const m = modules.get(filename) || await this.load(filename, opts)
    modules.set(filename, m)

    const isImport = (type || m.type) === 'module'
    const id = ((opts && opts.anyContext) ? '-' : (isImport ? 'i' : 'c')) + filename

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
    if (this.mapResolve) req = this.mapResolve(req, basedir)
    if (isImport && isCustomScheme(req)) return req
    if (this.builtins.has(req)) return req

    const self = this
    const runtimes = isImport ? this._importRuntimes : this._requireRuntimes

    return new Promise((resolve, reject) => {
      resolveModule(req, {
        basedir,
        extensions: ['.js', '.mjs', '.cjs', '.json'],
        realpath (name, cb) {
          cb(null, name)
        },
        isFile: (name, cb) => {
          self._isFile(name).then((yes) => cb(null, yes), cb)
        },
        isDirectory: (name, cb) => {
          self._isDirectory(name).then((yes) => cb(null, yes), cb)
        },
        readFile: (name, cb) => {
          self._readFile(name).then((buf) => cb(null, buf), cb)
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

function sniffJS (src) {
  const s1 = src.match(/"[^"]+"/ig)
  const s2 = src.match(/'[^']+'/ig)

  const entries = []

  if (s1) {
    for (const s of s1) {
      if (/\.(m|c)?js"$/.test(s)) {
        entries.push(s.slice(1, -1))
      }
    }
  }

  if (s2) {
    for (const s of s2) {
      if (/\.(m|c)?js'$/.test(s)) {
        entries.push(s.slice(1, -1))
      }
    }
  }

  return entries.filter(e => !isCustomScheme(e))
}
