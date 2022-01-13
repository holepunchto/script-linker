const b4a = require('b4a')
const cjs = require('cjs-module-lexer')
const mjs = require('es-module-lexer')
const detective = require('detective')
const isProperty = require('is-property')
const acorn = require('acorn')
const sourceMap = require('source-map')
const unixresolve = require('unix-path-resolve')

module.exports = class JSModule {
  constructor (linker, filename, { defaultType = linker.defaultType } = {}) {
    this.linker = linker
    this.builtin = this.linker.builtins.has(filename)
    this.filename = (this.builtin) ? filename : unixresolve(filename)
    this.dirname = (this.builtin) ? '/' : unixresolve(this.filename, '..')
    this.defaultType = defaultType
    this.builtin = false
    this.type = null
    this.package = null
    this.malformedPackageJSON = false
    this.source = null
    this.sourceMap = null
    this.resolutions = null
    this.cache = 0
    this.loaded = false

    this._refreshing = null
    this._exports = null

    this._reset = () => {
      this._refreshing = null
    }
  }

  get exports () { // lazy as it's not always used
    if (this._exports || !this.loaded) return this._exports
    try {
      if (this.type === 'commonjs') {
        const r = cjs.parse(this.source)

        this._exports = {
          default: true,
          named: r.exports
        }
      }

      if (this.type === 'module') {
        const r = mjs.parse(this.source)

        this._exports = {
          default: r[1].includes('default'),
          named: r[1].filter(d => d !== 'default')
        }
      }

      if (this.type === 'json') {
        this._exports = {
          default: true,
          named: []
        }
      }
    } catch {
      return this._exports
    }

    return this._exports
  }

  generateSourceMap () {
    if (this.sourceMap) return this.sourceMap
    this.sourceMap = this._generateSourceMap()
    return this.sourceMap
  }

  _transform (transforms) {
    let out = ''
    let p = 0

    if (this.resolutions) {
      for (const r of this.resolutions) {
        const [ss, s, e] = r.replace

        let start = p
        let end = p
        let t = ''

        if (r.input) {
          if (r.isImport) { // import "string"
            if (r.output) {
              start = s
              end = e
              t = JSON.stringify(this.linker.map(r.output, { isImport: true, isBuiltin: this.linker.builtins.has(r.output), isSourceMap: false }))
            } else {
              start = ss
              end = e
              t = 'throw new Error(' + errorString(r.input, this.filename, true) + ')'
            }
          } else { // require("string")
            const err = r.output ? '' : ', error: ' + errorString(r.input, this.filename, false)
            start = s
            end = e
            t = JSON.stringify(r.output || r.input) + ', { resolved: ' + !!r.output + err + ' }'
          }
        } else {
          if (r.isImport) { // import(expr)
            start = ss
            end = s
            t = createImportString(this.filename)
          }
          // and no else since no transform for dynamic requires - they are fully resolved on runtime
        }

        out += this.source.slice(p, start)
        p = end

        if (transforms) transforms.push({ original: r.replace, generated: [out.length, out.length + t.length] })
        out += t
      }
    }

    out += this.source.slice(p)
    out += (out.endsWith('\n') ? '' : '\n') + (this.type === 'json' ? '' : '//# sourceURL=' + this.filename) + '\n'

    if (this.linker.linkSourceMaps && this.resolutions && this.resolutions.length) {
      out += '//# sourceMappingURL=' + this.linker.map(this.filename, { isImport: this.type === 'module', isBuiltin: this.builtin, isSourceMap: true }) + '\n'
    }

    return out
  }

  toCJS () {
    if (this.type === 'module') throw new Error('Cannot convert an ESM module to CommmonJS')
    if (this.type === 'json') return this.source
    return this._transform(null)
  }

  toESM () {
    if (this.malformedPackageJSON) {
      let err = null
      if (this.type === 'json') {
        err = new TypeError(' [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".json" for ' + this.filename)
        err.code = 'ERR_UNKNOWN_FILE_EXTENSION'
      } else {
        err = new Error('[ERR_INVALID_PACKAGE_CONFIG]: Invalid package config while importing ' + this.filename)
        err.code = 'ERR_INVALID_PACKAGE_CONFIG'
      }
      throw err
    }
    if (this.type === 'module') return this._transform(null)

    const e = this.exports
    let out = ''

    out += `const mod = global[Symbol.for('scriptlinker')].require(${JSON.stringify(this.filename)}, { resolved: true, source: ${JSON.stringify(this.toCJS())} })\n`

    if (e) {
      for (const key of e.named) {
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

  resolve (ns, opts) {
    return this.linker.resolve(ns, this.dirname, opts)
  }

  refresh () {
    if (this._refreshing) return this._refreshing
    this._refreshing = this._refresh().finally(this._reset)
    return this._refreshing
  }

  async _refresh () {
    const isBuiltin = this.linker.builtins.has(this.filename)

    if (isBuiltin) {
      const b = await this.linker.builtins.get(this.filename)
      this._optimiseBuiltin(b)
      this.loaded = true
      return
    }

    await mjs.init
    await cjs.init()

    const stat = this.linker._userStat && await this.linker._userStat(this.filename)
    const src = await this.linker._userReadFile(this.filename, stat)

    let type = (stat && stat.type) || null
    let pkg = null

    if (this.filename.endsWith('.json')) {
      type = 'json'
      try { JSON.parse(src) } catch { this.malformedPackageJSON = true }
    }

    if (this.filename.endsWith('.mjs')) {
      type = 'module'
    }

    if (this.filename.endsWith('.cjs')) {
      type = 'commonjs'
    }

    if (!type) {
      pkg = await this.linker.findPackageJSON(this.filename)
      if (!pkg) this.malformedPackageJSON = true
      type = pkg && pkg.type === 'module' ? 'module' : (pkg && pkg.type === 'commonjs' ? 'commonjs' : this.defaultType)
    }

    if (stat && stat.cache && this.cache === stat.cache && type === this.type) {
      await this.updateResolutions()
      return
    }

    const source = typeof src === 'string' ? src : b4a.toString(src)

    if (this.source && source === this.source && type === this.type) {
      this.sourceMap = ''
      await this.updateResolutions()
      return
    }

    let resolutions = (stat && stat.resolutions) || null
    if (!resolutions) {
      const o = type === 'json'
        ? { exports: { default: true, named: [] }, resolutions: [] }
        : type === 'module'
          ? await this._optimiseMJS(source)
          : await this._optimiseCJS(source)

      this._exports = o.exports
      resolutions = o.resolutions
    } else {
      resolutions = resolutions.filter(noDynamicRequires) // just future proofing it here
    }

    this.type = type
    this.package = pkg
    this.resolutions = resolutions
    this.source = source
    this.builtin = false
    this.cache = (stat && stat.cache) || 0
    this.sourceMap = ''
    this.loaded = true
  }

  async updateResolutions (resolutions = this.resolutions) {
    const p = []
    for (const res of resolutions) {
      p.push(res.input ? this.resolve(res.input, { isImport: res.isImport }) : Promise.resolve(null))
    }
    const outs = await Promise.allSettled(p)
    for (let i = 0; i < outs.length; i++) {
      resolutions[i].output = outs[i].status === 'fulfilled' ? outs[i].value : null
    }
  }

  _optimiseBuiltin (mod) {
    if (this.loaded) return

    this.builtin = true
    this.type = 'module'
    this.package = null
    this.resolutions = []
    this._exports = {
      named: [],
      default: true
    }

    let src = `const mod = global[Symbol.for('scriptlinker')].require(${JSON.stringify(this.filename)})\n`

    for (const key of Object.keys(mod)) {
      if (key === 'default') continue
      if (!isProperty(key)) continue
      this._exports.named.push(key)
      src += `export const ${key} = mod.${key}\n`
    }

    src += 'export default mod'

    this.source = src
  }

  async _optimiseMJS (input) {
    const r = mjs.parse(input)

    const imports = r[0]
    const resolutions = []

    for (const i of imports) {
      if (i.n) {
        if (isCustomScheme(i.n)) continue
        const q = (i.d > -1 ? 0 : 1)
        resolutions.push({
          isImport: true,
          replace: [i.ss, i.s - q, i.e + q],
          input: i.n,
          output: null
        })
      } else if (i.ss !== i.s) { // ie not import.meta
        resolutions.push({
          isImport: true,
          replace: [i.ss, i.s - 1, -1],
          input: null,
          output: null
        })
      }
    }

    await this.updateResolutions(resolutions)

    return {
      resolutions,
      exports: {
        default: r[1].includes('default'),
        named: r[1].filter(d => d !== 'default')
      }
    }
  }

  async _optimiseCJS (input) {
    const r = detective.find(input, { nodes: true })
    const resolutions = []

    for (let i = 0; i < r.nodes.length; i++) {
      const node = r.nodes[i]
      if (!node.arguments.length || node.type !== 'CallExpression') continue
      const arg = node.arguments[0]
      if (arg.type !== 'Literal') continue
      if (this.linker.builtins.has(arg.value)) continue

      resolutions.push({
        isImport: false,
        replace: [-1, arg.start, arg.end],
        input: arg.value,
        output: null
      })
    }

    await this.updateResolutions(resolutions)

    return {
      resolutions,
      exports: null
    }
  }

  _generateSourceMap () {
    if (this.type !== 'module' && this.type !== 'commonjs') return ''

    const transforms = []
    const filename = this.filename

    const source = this._transform(transforms)

    const generator = new sourceMap.SourceMapGenerator({
      file: filename,
      sourceRoot: '/'
    })

    let p = 0
    let cur = p < transforms.length ? transforms[p++] : null

    let line = 0
    let columnDelta = 0

    let nextDelta = 0
    let firstTransformed = null

    acorn.parse(source, {
      locations: true,
      sourceType: this.type === 'module' ? 'module' : 'script',
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

    generator.setSourceContent(filename, this.source)

    return generator.toString()

    function push (origLine, origCol, genLine, genCol) {
      const m = {
        source: filename,
        original: { line: origLine, column: origCol },
        generated: { line: genLine, column: genCol }
      }
      generator.addMapping(m)
    }
  }
}

function noDynamicRequires (r) {
  return r.isImport || r.output
}

function createImportString (filename) {
  return `global[Symbol.for('scriptlinker')].createImport(${JSON.stringify(filename)}, (req) => import(req))`
}

function errorString (input, filename, isImport) {
  return JSON.stringify(`Cannot find ${isImport ? 'package' : 'module'} '${input}' ${isImport ? 'import' : 'requir'}ed from ${filename})`)
}

function isCustomScheme (str) {
  return /^[a-z][a-z0-9]+:/i.test(str)
}
