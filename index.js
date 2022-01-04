const Mod = require('./lib/module')
const defaultCompile = require('./lib/compile')
const resolveModule = require('resolve')
const b4a = require('b4a')
const path = require('path')
const Module = require('module')
const unixify = require('./lib/unixify.js')
const Xcache = require('xache')

const DEFAULT_CACHE_SIZE = 500

const defaultBuiltins = {
  has (ns) {
    return Module.builtinModules.includes(ns)
  },
  get (ns) {
    return require(ns)
  }
}

class ScriptLinker {
  constructor ({ map = defaultMap, builtins = defaultBuiltins, linkSourceMaps = true, defaultType = 'commonjs', stat, readFile, isFile, isDirectory, cacheSize }) {
    this.map = map
    this.modules = new Xcache({ maxSize: cacheSize || DEFAULT_CACHE_SIZE })
    this.builtins = builtins
    this.linkSourceMaps = linkSourceMaps
    this.defaultType = defaultType

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

  async findPackageJSON (filename, { directory = false } = {}) {
    let dirname = directory ? filename : path.dirname(filename)

    while (true) {
      try {
        const src = await this._userReadFile(path.join(dirname, 'package.json'))
        return JSON.parse(typeof src === 'string' ? src : b4a.from(src))
      } catch {
        const next = path.join(dirname, '..')
        if (next === dirname) return null
        dirname = next
      }
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

  async resolve (ns, basedir, { isImport = true } = {}) {
    const self = this

    return new Promise((resolve, reject) => {
      resolveModule(ns, {
        basedir,
        extensions: ['.js', '.mjs', '.cjs'],
        realpath (name, cb) {
          cb(null, name)
        },
        isFile: (name, cb) => {
          console.log(name)
          self._isFile(name, cb)
        },
        isDirectory: (name, cb) => {
          self._isDirectory(name, cb)
        },
        readFile: (name, cb) => {
          self._readFile(name, cb)
        },
        packageFilter (pkg, pkgfile, dir) {
          if (isImport) {
            const esmMain = getPath(pkg, ['exports', 'import']) || getPath(pkg, ['exports', '.', 'import'])
            if (esmMain) pkg.main = esmMain
          }
          return pkg
        },
        pathFilter (pkg, path, relativePath) {
          // TODO: can be used to impl the full export mapping for file imports
          return relativePath
        }
      }, function (err, res) {
        if (err) return reject(err)
        resolve(unixify(res))
      })
    })
  }

  static preload (opts) {
    const {
      map = defaultMap,
      builtins = defaultBuiltins,
      compile = defaultCompile,
      getSync,
      resolveSync
    } = opts

    const SLModule = defineModule()

    const sl = global[Symbol.for('scriptlinker')] = {
      Module: SLModule,
      require: null,
      createImport (filename, doImport) {
        const dirname = path.dirname(filename)
        return (req) => {
          try {
            const r = resolveImport(dirname, req)
            return doImport(r)
          } catch {
            return Promise.reject(new Error(`Cannot find package '${req}' imported from ${filename}`))
          }
        }
      },
      createRequire (filename, parent = null) {
        if (!parent) {
          parent = new SLModule(filename, null)
          parent.filename = filename
        }

        require.resolve = resolve
        require.cache = SLModule._cache
        require.extensions = SLModule._extensions
        require.main = undefined

        return require

        function resolve (request, opts) {
          return SLModule._resolveFilename(request, parent, false, opts)
        }

        function require (request, opts) {
          return parent.require(request, opts)
        }
      }
    }

    sl.require = sl.createRequire('/')

    return sl

    function resolveImport (dirname, req) {
      const isBuiltin = builtins.has(req)
      return map(isBuiltin ? req : resolveSync(req, dirname, { isImport: true }), { isImport: true, isBuiltin, isSourceMap: false })
    }

    function getExtension (filename) {
      const i = filename.lastIndexOf('.')
      return i > -1 ? filename.slice(i) : filename
    }

    function defineModule () {
      function Module (id = '', parent) {
        this.id = id
        this.path = unixify(path.dirname(id))
        this.exports = {}
        this.filename = null
        this.loaded = false
        this.children = [] // TODO: not updated atm
        this.paths = []
        this.parent = parent
      }

      Module._cache = Object.create(null)
      Module._pathCache = Object.create(null) // only there in case someone inspects it
      Module.Module = Module
      Module.syncBuiltinESMExports = () => {} // noop for now
      Module.globalPaths = []
      Module.builtinModules = [] // not populated atm but could be if we need to ...

      Module.createRequire = function (filename) {
        return sl.createRequire(filename, null)
      }

      Module._resolveFilename = function (request, parent, isMain, opts) {
        if (opts && opts.resolved) return request
        if (opts && opts.error) throw new Error(opts.error)
        if (request === 'module') return request // special case for this module
        try {
          return builtins.has(request) ? request : resolveSync(request, parent.path, { isImport: false })
        } catch {
          throw new Error(`Cannot find module '${request}' required from ${parent.id}`)
        }
      }

      Module._load = function (request, parent, isMain, opts) {
        const filename = Module._resolveFilename(request, parent, isMain, opts)
        const cached = Module._cache[filename]
        if (cached) return cached.exports
        if (filename === 'module') return Module
        if (builtins.has(filename)) return builtins.get(filename)
        const mod = new Module(filename, parent)
        Module._cache[filename] = mod
        let threw = true
        try {
          mod.load(filename, opts)
          threw = false
        } finally {
          if (threw) {
            delete Module._cache[filename]
          }
        }
        return mod.exports
      }

      Module._extensions = {
        '.js': function (mod, filename, opts) {
          mod._compile(Module._getSource(filename, opts), filename)
        },
        '.json': function (mod, filename, opts) {
          mod.exports = JSON.parse(Module._getSource(filename, opts))
        }
      }

      Module._getSource = function (filename, opts) {
        return typeof (opts && opts.source) === 'string' ? opts.source : getSync(map(filename, { isImport: false, isBuiltin: false, isSourceMap: false }))
      }

      Module.prototype._compile = function (source, filename) {
        compile(this, this.exports, this.path, filename, sl.createRequire(this.path, this), source)
      }

      Module.prototype.require = function (request, opts) {
        return Module._load(request, this, false, opts)
      }

      Module.prototype.load = function (filename, opts) {
        this.filename = filename
        const ext = Module._extensions[getExtension(filename)] || Module._extensions['.js']
        ext(this, filename, opts)
        this.loaded = true
      }

      return Module
    }
  }
}

ScriptLinker.defaultCompile = defaultCompile
ScriptLinker.defaultMap = defaultMap
ScriptLinker.defaultBuiltins = defaultBuiltins
ScriptLinker.defaultUserspace = '-'

module.exports = ScriptLinker

function getPath (o, path) {
  for (let i = 0; i < path.length && o; i++) o = o[path[i]]
  return o
}

function defaultMap (id, { isImport, isBuiltin, isSourceMap }) {
  return (isImport ? 'module://' : 'commonjs://') + (isBuiltin ? '' : ScriptLinker.defaultUserspace) + id + (isSourceMap ? '.map' : '')
}
