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
    this.userspace = userspace
    this.bare = bare

    this._ns = bare ? '' : 'global[Symbol.for(\'scriptlinker\')].'
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

  async bundle (filename, { builtins } = {}) {
    if (!this.bare) throw new Error('Bundling only works in bare mode')

    let cjs = []
    let esm = ''
    let main = null
    let out = '{\n'

    for await (const { isImport, module } of this.dependencies(filename)) {
      if (main === null) main = module
      if (isImport === false || module.builtin || module.type === 'commonjs') {
        cjs.push(module)
      }
      if (isImport) {
        if (esm) esm += ',\n'
        esm += '    ' + JSON.stringify('bundle:' + module.filename) + ': '
        esm += JSON.stringify('data:application/javascript;base64,' + Buffer.from(module.toESM()).toString('base64'))
      }
    }

    if (esm) esm += '\n'

    if (esm) {
      out += '{\n  const im = document.createElement(\'script\')\n'
      out += '  im.type = \'importmap\'\n'
      out += '  im.textContent = JSON.stringify({ imports: {\n'
      out += esm
      out += '  }})\n'
      out += '  document.currentScript.before(im)\n}\n'
    }

    if (cjs.length) {
      cjs = [...new Set(cjs)] // no dups
      out += 'require.cache = {\n'
      for (let i = cjs.length - 1; i >= 0; i--) {
        const e = (cjs[i].builtin && builtins) ? builtins + '.get(' + JSON.stringify(cjs[i].filename) + ')' : '{}'
        out += '  ' + JSON.stringify(cjs[i].filename) + ': { exports: ' + e + ' }' + (i === 0 ? '' : ',') + '\n'
      }
      out += '}\n'
      out += 'require.scope = function (map, fn) {\n'
      out += '  scopedRequire.cache = require.cache\n'
      out += '  fn(scopedRequire)\n'
      out += '  function scopedRequire (req) {\n'
      out += '    if (!map.hasOwnProperty(req)) throw new Error("Cannot require \'" + req + "\'")\n'
      out += '    return require(map[req])\n'
      out += '  }\n'
      out += '}\n'
      for (let i = cjs.length - 1; i >= 0; i--) {
        const mod = cjs[i]
        if (mod.builtin) continue
        const map = mod.requireMap() || {}
        out += 'require.scope(' + JSON.stringify(map) + ', function (require, '
        out += '__filename = ' + JSON.stringify(mod.filename) + ', '
        out += '__dirname = ' + JSON.stringify(mod.dirname) + ', '
        out += 'module = require.cache[' + JSON.stringify(mod.filename) + ']) {\n'
        out += mod.toCJS()
        out += '})\n'
      }
      out += 'function require (req) {\n'
      out += '  if (!require.cache.hasOwnProperty(req)) throw new Error("Cannot require \'" + req + "\'")\n'
      out += '  return require.cache[req].exports\n'
      out += '}\n'
    }

    if (main.type === 'module') {
      out += 'import(' + JSON.stringify('bundle:' + main.filename) + ')\n'
    }

    out += '}\n'
    return out
  }

  static runtime (opts) {
    return runtime(opts)
  }
}

ScriptLinker.defaults = d

module.exports = ScriptLinker

function getPath (o, path) {
  for (let i = 0; i < path.length && o; i++) o = o[path[i]]
  return o
}

function isCustomScheme (str) {
  return /^[a-z][a-z0-9]+:/i.test(str)
}
