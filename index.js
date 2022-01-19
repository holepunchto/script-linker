const resolveModule = require('resolve')
const b4a = require('b4a')
const unixresolve = require('unix-path-resolve')
const Xcache = require('xache')
const Mod = require('./lib/module')
const d = require('./lib/defaults')
const runtime = require('./runtime')

class ScriptLinker {
  constructor ({
    map = d.map,
    mapImport = d.mapImport,
    builtins = d.builtins,
    linkSourceMaps = d.linkSourceMaps,
    defaultType = d.type,
    cacheSize = d.cacheSize,
    userspace = d.userspace,
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
    this.userspace = userspace

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

  _mapImport (id) {
    if (isCustomScheme(id)) return id
    return this.map(id, {
      userspace: this.userspace,
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

  async resolve (req, basedir, { isImport = true } = {}) {
    if (isImport) {
      req = this.mapImport(req, basedir)
      if (isCustomScheme(req)) return req
    }

    if (this.builtins.has(req)) return req

    const self = this

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
        resolve(unixresolve(res))
      })
    })
  }

  static runtime (opts) {
    return runtime(opts)
  }
}

ScriptLinker.defaultCompile = d.compile
ScriptLinker.defaultMap = d.map
ScriptLinker.defaultMapImport = d.mapImport
ScriptLinker.defaultBuiltins = d.builtins
ScriptLinker.defaultUserspace = d.userspace

module.exports = ScriptLinker

function getPath (o, path) {
  for (let i = 0; i < path.length && o; i++) o = o[path[i]]
  return o
}

function isCustomScheme (str) {
  return /^[a-z][a-z0-9]+:/i.test(str)
}
