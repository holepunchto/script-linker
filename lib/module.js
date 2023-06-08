const b4a = require('b4a')
const isValidVariable = require('is-valid-variable')
const acorn = require('acorn')
const sourceMap = require('source-map')
const unixresolve = require('unix-path-resolve')
const parse = require('./parse')

module.exports = class Module {
  constructor (linker, filename, { defaultType = linker.defaultType } = {}) {
    this.linker = linker
    this.defaultType = defaultType
    this.loaded = false
    this.builtin = this.linker.builtins.has(filename)
    this.filename = this.builtin ? filename : unixresolve(filename)
    this.dirname = this.builtin ? '/' : unixresolve(this.filename, '..')
    this.source = ''
    this.refreshing = null
    this.warmup = 0 // set by index

    this._node = null
    this._module = null
    this._moduleInfo = null
    this._sourceMap = ''
    this._cjsExports = null
    this._reexports = null

    this._reset = () => { this.refreshing = null }
  }

  refresh () {
    if (this.refreshing) return this.refreshing
    this.refreshing = this._refresh().finally(this._reset)
    return this.refreshing
  }

  get type () {
    return this._module && this._module.type
  }

  get resolutions () {
    return this._module ? this._module.resolutions : []
  }

  get namedImports () {
    return this._module ? this._module.namedImports : []
  }

  get packageMalformed () {
    return this._moduleInfo ? this._moduleInfo.malformed : false
  }

  get packageFilename () {
    return this._moduleInfo && this._moduleInfo.filename
  }

  get package () {
    return this._moduleInfo && this._moduleInfo.package
  }

  get name () {
    return this.package && this.package.name
  }

  get rexports () {
    if (this._reexports) return this._reexports

    this._reexports = []
    for (const n of this.namedImports) {
      if (n.isExport && n.isWildcard && n.from.output) this._reexports.push(n.from.output)
    }
    return this._reexports
  }

  resolve (req, opts) {
    return this.linker.resolve(req, this.dirname, opts)
  }

  parseCJSExports () {
    if (this._cjsExports !== null || this.type !== 'commonjs') return

    this._cjsExports = new Set()
    for (const name of parse.exports(this.source, 'commonjs')) {
      if (isValidVariable(name)) this._cjsExports.add(name)
    }
  }

  addCJSExports (list) {
    if (this.type !== 'commonjs') return
    if (this._cjsExports === null) this.parseCJSExports()

    for (const name of list) {
      if (isValidVariable(name)) this._cjsExports.add(name)
    }
  }

  getCJSExports () {
    if (!this._module || this.type !== 'commonjs') return []
    if (!this._module.exports) {
      if (!this._cjsExports) this.parseCJSExports()
      this._module.exports = this._cjsExports ? [...this._cjsExports] : []
    }
    return this._module.exports
  }

  generateSourceMap () {
    if (this._sourceMap) return this._sourceMap
    this._sourceMap = this._generateSourceMap()
    return this._sourceMap
  }

  cache () {
    const mod = this._module
    if (!mod) return null

    return {
      type: mod.type,
      resolutions: mod.resolutions,
      exports: this._cjsExports ? this.getCJSExports() : null
    }
  }

  toCJS () {
    if (!this.loaded) return ''

    if (this._module.type === 'module') throw new Error('Cannot convert an ESM module to CommmonJS')
    if (this._module.type === 'json') return this.source

    return this._transform(null)
  }

  toESM () {
    if (!this.loaded) return ''

    if (this._moduleInfo && this._moduleInfo.malformed) {
      const err = new Error('[ERR_INVALID_PACKAGE_CONFIG]: Invalid package config while importing ' + this.filename)
      err.code = 'ERR_INVALID_PACKAGE_CONFIG'
      throw err
    }

    if (this._module.type === 'module') return this._transform(null)

    const f = this.linker.mapPath(this.filename)
    const req = this.linker._ns + 'require(' + JSON.stringify(f) + ', { resolved: true })'

    let out = ''

    out += 'const __mod__ = ' + req + '\n'

    for (const key of this.getCJSExports()) {
      if (key === '__mod__') continue
      out += `export const ${key} = __mod__.${key}\n`
    }

    out += 'export default (typeof __mod__ === \'object\' && __mod__ && __mod__.__esModule && __mod__.default !== undefined)'
    out += ' ? __mod__.default'
    out += ' : __mod__\n'

    out += '//# sourceURL=' + f + '+esm-wrap'

    return out
  }

  requireMap () {
    const resolutions = this._module && this._module.resolutions
    if (!resolutions) return null

    let map = null

    for (const r of resolutions) {
      if (r.isImport) continue
      if (!r.output) continue
      if (this.linker.builtins.has(r.input)) continue
      if (!map) map = {}
      map[r.input] = this.linker.mapPath(r.output)
    }

    return map
  }

  _transform (transforms) {
    let out = ''
    let p = 0
    let transformed = false

    const resolutions = this._module && this._module.resolutions

    if (resolutions) {
      const requireMap = this.linker.bare ? null : this.requireMap()

      if (requireMap) {
        out += '/* @scriptlinker-resolutions ' + JSON.stringify(requireMap) + ' */\n'
      }

      for (const r of resolutions) {
        if (!r.isImport) continue
        const [ss, s, e] = r.position

        let start = p
        let end = p
        let t = ''

        if (r.input) { // import "string"
          if (r.output) {
            start = s
            end = e
            const o = this.linker._mapImportPostResolve(r.output, this.dirname)
            if (o === r.input) continue // no change
            t = JSON.stringify(o)
          } else {
            start = ss
            end = e
            t = 'throw new Error(' + errorString(r.input, this.linker.mapPath(this.filename)) + ')'
          }
        } else { // import(expr)
          start = ss
          end = s
          t = createImportString(this.linker._ns, this.linker.mapPath(this.filename))
        }

        out += this.source.slice(p, start)
        p = end

        transformed = true
        if (transforms) transforms.push({ original: r.position, generated: [out.length, out.length + t.length] })
        out += t
      }
    }

    out += this.source.slice(p)

    const needsSourceMap = this.linker.linkSourceMaps && transformed && !this.linker.bare

    if (this.type !== 'json') {
      out += (out.endsWith('\n') ? '' : '\n') + '//# sourceURL='
      if (needsSourceMap) out += this.linker.mapPath(this.filename) + '+esm-transformed' // hack to make source maps look correct url wise
      else out += this._mapSelf(false, true)
      out += '\n'
    }

    if (needsSourceMap) {
      out += (out.endsWith('\n') ? '' : '\n')
      out += '//# sourceMappingURL=' + this._mapSelf(true, false) + '\n'
    }

    return out
  }

  _parse (source, type, strictMode) {
    if (this.loaded && this.source === source) return this._module
    return parse.parse(source, type, strictMode)
  }

  async _maybeLoadBuiltin () {
    try {
      return await this.linker.builtins.get(this.filename)
    } catch {
      return null
    }
  }

  async _refresh () {
    await parse.init()

    if (this.builtin) {
      // attempt to load the prebuilt for esm generation but graceful adapt if it can't
      if (this.loaded === false) {
        const b = await this._maybeLoadBuiltin()
        this._wrapBuiltin(b)
        this.loaded = true
      }
      return
    }

    const node = await this.linker.drive.entry(this.filename)

    if (this._node && node && this.linker.drive.compare(node, this._node) === 0) {
      // no changes, quick return
      return
    }

    const source = b4a.toString(await this.linker._readFile(this.filename, true))
    const cache = node && node.value && node.value.metadata

    const info = (cache && cache.type)
      ? { type: cache.type, filename: null, package: null, malformed: false }
      : await this._getModuleInfo()

    const mod = (cache && cache.resolutions)
      ? { type: info.type, resolutions: cache.resolutions, namedImports: [], exports: cache.exports || null }
      : this._parse(source, info.type || this.defaultType, !!info.type)

    if (!cache || !cache.resolutions) {
      this._sourceMap = ''
      await this._updateResolutions(mod.resolutions)
    } else {
      for (const r of mod.resolutions) {
        if (!r.isImport || !r.output) continue
        r.output = this.linker.mapImport(r.output, this.dirname)
      }
    }

    if (this._module !== mod) {
      this._node = node
      this._sourceMap = ''
      this._cjsExports = null
      this._reexports = null
    }

    this._module = mod
    this._moduleInfo = info

    this.warmup = 0
    this.source = source
    this.loaded = true
  }

  _wrapBuiltin (mod) {
    let src = `const __mod__ = ${this.linker._ns}require(${JSON.stringify(this.linker.mapPath(this.filename))})\n`

    this._module = {
      type: 'module',
      resolutions: [],
      namedImports: [],
      exports: []
    }

    if (mod !== null) {
      for (const key of Object.keys(mod)) {
        if (!isValidVariable(key) || key === '__mod__') continue
        this._module.exports.push(key)
        src += `export const ${key} = __mod__.${key}\n`
      }
    }

    src += 'export default __mod__\n'

    this.source = src
  }

  async _getModuleInfo () {
    const result = { type: null, filename: null, dirname: null, package: null, malformed: false }

    if (this.filename.endsWith('.mjs')) {
      result.type = 'module'
      return result
    }

    if (this.filename.endsWith('.cjs')) {
      result.type = 'commonjs'
      return result
    }

    if (this.filename.endsWith('.json')) {
      result.type = 'json'
      return result
    }

    try {
      result.filename = await this.linker.resolvePackageJSON(this.filename)
      result.dirname = unixresolve(result.filename, '..')
      result.package = await this.linker.readPackageJSON(result.filename)
    } catch {
      result.malformed = true
      return result
    }

    if (!result.package) return result

    result.type = result.package.type === 'module' ? 'module' : (result.package.type === 'commonjs' ? 'commonjs' : null)
    return result
  }

  async _updateResolutions (resolutions) {
    const p = []
    for (const res of resolutions) {
      p.push(res.input ? this.resolve(res.input, { isImport: res.isImport }) : Promise.resolve(null))
    }
    const outs = await Promise.allSettled(p)
    for (let i = 0; i < outs.length; i++) {
      resolutions[i].output = outs[i].status === 'fulfilled' ? outs[i].value : null
    }
  }

  _mapSelf (isSourceMap, isConsole) {
    return this.linker.map(this.linker.mapPath(this.filename), {
      protocol: this.linker.protocol,
      isImport: !!this._module && this._module.type === 'module',
      isBuiltin: this.builtin,
      isSourceMap,
      isConsole
    })
  }

  _generateSourceMap () {
    const type = this._module && this._module.type
    if (type !== 'module' && type !== 'commonjs') return ''

    const transforms = []

    const source = this._transform(transforms)
    const u = this._mapSelf(false, true)

    const generator = new sourceMap.SourceMapGenerator({ sourceRoot: '' })

    let p = 0
    let cur = p < transforms.length ? transforms[p++] : null

    let line = 0
    let columnDelta = 0

    let nextDelta = 0
    let firstTransformed = null

    acorn.parse(source, {
      locations: true,
      sourceType: type === 'module' ? 'module' : 'script',
      ecmaVersion: '2022',
      onToken (t) {
        if (t.loc.start.line !== line) {
          line = t.loc.start.line
          columnDelta = 0
          nextDelta = 0
        }

        if (cur && t.start >= cur.generated[1]) {
          cur = p < transforms.length ? transforms[p++] : null
        }

        if (cur && cur.generated[0] <= t.start && t.end <= cur.generated[1]) {
          if (!firstTransformed) {
            firstTransformed = t
            nextDelta = cur.generated[1] - cur.generated[0] - (cur.original[1] - cur.original[0])
          }
          push(firstTransformed.loc.start.line, firstTransformed.loc.start.column, t.loc.start.line, t.loc.start.column)
          return
        }

        if (nextDelta) {
          columnDelta += nextDelta
          nextDelta = 0
        }

        firstTransformed = null
        push(t.loc.start.line, t.loc.start.column - columnDelta, t.loc.start.line, t.loc.start.column)
      }
    })

    generator.setSourceContent(u, this.source)

    return generator.toString()

    function push (origLine, origCol, genLine, genCol) {
      const m = {
        source: u,
        original: { line: origLine, column: origCol },
        generated: { line: genLine, column: genCol }
      }
      generator.addMapping(m)
    }
  }
}

function createImportString (ns, filename) {
  return `${ns}createImport(${JSON.stringify(filename)}, (req) => import(req))`
}

function errorString (input, filename) {
  return JSON.stringify(`Cannot find package '${input}' imported from ${filename})`)
}
