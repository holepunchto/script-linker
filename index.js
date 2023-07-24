const resolveModule = require('resolve')
const b4a = require('b4a')
const unixresolve = require('unix-path-resolve')
const em = require('exports-map')
const RW = require('read-write-mutexify')
const safetyCatch = require('safety-catch')
const Mod = require('./lib/module')
const bundle = require('./lib/bundle')
const compat = require('./lib/compat')
const errors = require('./lib/errors')
const d = require('./defaults')
const runtime = require('./runtime')
const link = require('./link')

class ScriptLinker {
  constructor (drive, {
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
    sourceOverwrites
  } = {}) {
    this.map = map
    this.mapImport = mapImport
    this.mapResolve = mapResolve
    this.mapPath = mapPath
    this.modules = new Map()
    this.builtins = builtins
    this.linkSourceMaps = linkSourceMaps
    this.defaultType = defaultType
    this.symbol = symbol
    this.protocol = protocol
    this.bare = bare
    this.drive = drive
    this.sourceOverwrites = sourceOverwrites || null

    this._rw = new RW()
    this._warmups = 0
    this._importRuntimes = new Set(['module', 'import', ...runtimes])
    this._requireRuntimes = new Set(['require', ...runtimes])
    this._ns = bare ? '' : 'global[Symbol.for(\'' + symbol + '\')].'
  }

  async _readFile (nodeOrName, error) {
    const name = typeof nodeOrName === 'string' ? nodeOrName : nodeOrName.key

    if (this.sourceOverwrites !== null && Object.hasOwn(this.sourceOverwrites, name)) {
      const overwrite = this.sourceOverwrites[name]
      return typeof overwrite === 'string' ? b4a.from(overwrite) : overwrite
    }

    const src = await this.drive.get(nodeOrName)
    if (src === null && error) throw errors.ENOENT(name)

    return src
  }

  async _isFile (name) {
    const node = await this.drive.entry(name)
    return node !== null && !!(node.value && node.value.blob)
  }

  async _isDirectory (name) {
    const node = await this.drive.entry(name)
    return node === null
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
    const pkg = await this.resolvePackageJSON(filename, { directory })
    if (pkg === null) return null
    const src = await this._readFile(pkg, false)
    if (!src) return null
    return JSON.parse(typeof src === 'string' ? src : b4a.from(src))
  }

  async warmup (entryPoint, opts) {
    await this._rw.write.lock()

    try {
      return await this._warmup(entryPoint, opts)
    } finally {
      this._rw.write.unlock()
    }
  }

  async _warmup (entryPoint, opts) {
    const modules = new Map()
    const warmups = ++this._warmups

    opts = { ...opts, noLock: true }

    for await (const { isImport, module } of this.dependencies(entryPoint, opts, new Set(), modules)) {
      if (isImport && module.type === 'commonjs') module.parseCJSExports() // warm this up
    }

    for (const mod of modules.values()) {
      mod.warmup = warmups
      if (mod.type !== 'module') continue

      for (const { names, from } of mod.namedImports) {
        if (!from.output) continue

        let target = modules.get(from.output)

        // if this is a simple module forward, forward the info
        while (target && target.type === 'module' && target.rexports.length === 1) {
          target = modules.get(target.rexports[0])
        }

        // forward the named exports so they can be generated for us
        if (target && target.type === 'commonjs') {
          target.addCJSExports(names)
        }
      }
    }

    return modules
  }

  async * dependencies (filename, opts, visited = new Set(), modules = new Map(), type = null) {
    this._prefetch(filename, opts, new Set(), modules, type).catch(safetyCatch)

    if (Array.isArray(filename)) {
      for (const f of filename) yield * this.dependencies(f, opts, visited, modules, type)
      return
    }

    if (isCustomScheme(filename)) return
    if (opts && opts.filter && !opts.filter(filename)) return

    if (filename.endsWith('.html')) {
      const src = await this._readFile(filename, true)
      if (src === null) return

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

  async _prefetch (filename, opts, visited = new Set(), modules = new Map(), type = null) {
    if (Array.isArray(filename)) {
      const promises = []
      for (const f of filename) promises.push(this._prefetch(f, opts, visited, modules, type))
      return Promise.all(promises)
    }

    if (isCustomScheme(filename)) return
    if (opts && opts.filter && !opts.filter(filename)) return

    if (filename.endsWith('.html')) {
      const src = await this._readFile(filename, true)
      if (src === null) return

      const entries = sniffJS(b4a.toString(src)) // could be improved to sniff custom urls also
      const dir = unixresolve(filename, '..')
      const promises = []

      for (const entry of entries) {
        try {
          promises.push(this._prefetch(unixresolve(dir, entry), opts, visited, modules, null))
        } catch {
          continue // prob just an invalid js file we hit
        }
      }

      return Promise.all(promises)
    }

    // We could extract this in a different method like _loadDependency
    const m = modules.get(filename) || await this.load(filename, opts)
    modules.set(filename, m)

    const isImport = (type || m.type) === 'module'
    const id = ((opts && opts.anyContext) ? '-' : (isImport ? 'i' : 'c')) + filename

    if (visited.has(id)) return
    visited.add(id)

    const promises = []

    for (const r of m.resolutions) {
      if (r.output) {
        promises.push(this._prefetch(r.output, opts, visited, modules, r.isImport ? 'module' : 'commonjs'))
      }
    }

    return Promise.all(promises)
  }

  async load (filename, opts) {
    if (opts && opts.noLock === true) return this._load(filename, opts)

    await this._rw.read.lock()

    try {
      return await this._load(filename, opts)
    } finally {
      this._rw.read.unlock()
    }
  }

  async _load (filename, opts) {
    const forceRefresh = !!opts && opts.refresh === true

    let m = this.modules.get(filename)

    if (m) {
      if (this._warmups === 0 || m.warmup !== this._warmups || forceRefresh) await m.refresh()
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

  async transform ({ isSourceMap, isImport, transform = isImport ? 'esm' : isSourceMap ? 'map' : 'cjs', filename, resolve, dirname, refresh }) {
    if (!filename) filename = await this.resolve(resolve, dirname)

    const mod = await this.load(filename, { refresh })

    if (transform === 'cjs') return mod.toCJS()
    if (transform === 'map') return mod.generateSourceMap()
    if (transform === 'esm') return mod.toESM()

    return mod.source
  }

  async resolve (req, basedir, { transform = 'esm', isImport = transform === 'esm' } = {}) {
    if (this.mapResolve) req = this.mapResolve(req, basedir)
    if (isImport && isCustomScheme(req)) return req
    if (this.builtins.has(req)) return req

    if (compat.isPreact(req)) isImport = false

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
          self._readFile(name, true).then((buf) => cb(null, buf), cb)
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
