const b4a = require('b4a')
const isProperty = require('is-property')
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

    this._module = null
    this._moduleInfo = null
    this._sourceMap = ''

    this._refreshing = null
    this._reset = () => { this._refreshing = null }
  }

  refresh () {
    if (this._refreshing) return this._refreshing
    this._refreshing = this._refresh().finally(this._reset)
    return this._refreshing
  }

  get exports () { // lazy as it's not always used
    if (!this._module) return null

    try {
      if (!this._module.exports) {
        this._module.exports = parse.exports(this.source, this.type)
      }
    } catch {}

    return this._module.exports
  }

  get type () {
    return this._module && this._module.type
  }

  get resolutions () {
    return this._module ? this._module.resolutions : []
  }

  get packageMalformed () {
    return this._moduleInfo ? this._moduleInfo.malformed : false
  }

  get package () {
    return this._moduleInfo && this._moduleInfo.package
  }

  resolve (req, opts) {
    return this.linker.resolve(req, this.dirname, opts)
  }

  async _readSource (stat) {
    const b = await this.linker._userReadFile(this.filename, stat)
    return b4a.isBuffer(b) ? b4a.toString(b) : b
  }

  generateSourceMap () {
    if (this._sourceMap) return this._sourceMap
    this._sourceMap = this._generateSourceMap()
    return this._sourceMap
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

    const e = this.exports

    let out = ''

    out += 'const mod = ' + requireFromSource(this.filename, this.toCJS()) + '\n'

    if (e) {
      for (const key of e.named) {
        if (key === 'default') continue
        if (!isProperty(key)) continue
        out += `export const ${key} = typeof mod.${key} === 'function' ? mod.${key}.bind(mod) : mod.${key}\n`
      }
      if (e.default) {
        out += 'export default mod\n'
      }
    }

    out += '//# sourceURL=' + this.filename + '+esm-wrap'

    return out
  }

  _transform (transforms) {
    let out = ''
    let p = 0
    let transformed = false

    const resolutions = this._module && this._module.resolutions

    if (resolutions) {
      let requireMap = null

      for (const r of resolutions) {
        if (r.isImport) continue
        if (!r.output) continue
        if (this.linker.builtins.has(r.input)) continue
        if (!requireMap) requireMap = {}
        requireMap[r.input] = r.output
      }

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
            const o = this.linker._mapImportPostResolve(r.output)
            if (o === r.output) continue // no change
            t = JSON.stringify(o)
          } else {
            start = ss
            end = e
            t = 'throw new Error(' + errorString(r.input, this.filename) + ')'
          }
        } else { // import(expr)
          start = ss
          end = s
          t = createImportString(this.filename)
        }

        out += this.source.slice(p, start)
        p = end

        transformed = true
        if (transforms) transforms.push({ original: r.position, generated: [out.length, out.length + t.length] })
        out += t
      }
    }

    out += this.source.slice(p)

    const needsSourceMap = this.linker.linkSourceMaps && transformed

    if (this.type !== 'json') {
      out += (out.endsWith('\n') ? '' : '\n') + '//# sourceURL='
      if (needsSourceMap) out += this.filename + '+esm-raw' // hack to make source maps look correct url wise
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

  async _refresh () {
    await parse.init()

    if (this.builtin) {
      const b = await this.linker.builtins.get(this.filename)
      this._wrapBuiltin(b)
      this.loaded = true
      return
    }

    const stat = this.linker._userStat && await this.linker._userStat(this.filename)
    const source = await this._readSource(stat)

    const info = (stat && stat.type)
      ? { type: stat.type, package: null, malformed: false }
      : await this._getModuleInfo()

    const mod = (stat && stat.resolutions)
      ? { type: info.type, resolutions: stat.resolutions, exports: stat.exports }
      : this._parse(source, info.type || this.defaultType, !!info.type)

    if (!stat || !stat.resolutions) {
      this._sourceMap = ''
      await this._updateResolutions(mod.resolutions)
    }

    if (this._sourceMap && this._module !== mod) {
      this._sourceMap = ''
    }

    this._module = mod
    this._moduleInfo = info

    this.source = source
    this.loaded = true
  }

  _wrapBuiltin (mod) {
    let src = `const mod = global[Symbol.for('scriptlinker')].require(${JSON.stringify(this.filename)})\n`

    this._module = {
      type: 'module',
      resolutions: [],
      exports: {
        default: true,
        named: []
      }
    }

    for (const key of Object.keys(mod)) {
      if (key === 'default') continue
      if (!isProperty(key)) continue
      this._module.exports.named.push(key)
      src += `export const ${key} = mod.${key}\n`
    }
    src += 'export default mod'

    this.source = src
  }

  async _getModuleInfo () {
    const result = { type: null, package: null, malformed: false }

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
      result.package = await this.linker.findPackageJSON(this.filename)
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
    return this.linker.map(this.filename, {
      userspace: this.linker.userspace,
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

function createImportString (filename) {
  return `global[Symbol.for('scriptlinker')].createImport(${JSON.stringify(filename)}, (req) => import(req))`
}

function requireFromSource (filename, src) {
  return `global[Symbol.for('scriptlinker')].requireFromSource(${JSON.stringify(filename)}, ${JSON.stringify(src)})`
}

function errorString (input, filename) {
  return JSON.stringify(`Cannot find package '${input}' imported from ${filename})`)
}
