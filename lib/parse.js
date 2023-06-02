const mjs = require('es-module-lexer')
const cjs = require('cjs-module-lexer')
const srp = require('./sloppy-require-parser')

exports.init = async function init () {
  await mjs.init
}

exports.parse = function parse (src, type = 'module', strictMode = true) {
  const result = {
    type,
    resolutions: [],
    namedImports: [],
    exports: null
  }

  if (type === 'json') {
    result.exports = []
    return result
  }

  const [imp, exp] = mjsParse(src)
  const esm = type === 'module'

  if (!esm && exp.length > 0) {
    if (!strictMode) return parse(src, 'module', true)
    throw new Error('Export expression not allowed in cjs')
  }

  for (const i of imp) {
    if (i.d === -1 && !esm) {
      if (!strictMode) return parse(src, 'module', true)
      throw new Error('Import statement not allowed in cjs')
    }

    if (i.n) {
      const q = (i.d > -1 ? 0 : 1)
      const names = i.d === -1 ? parseNames(src.slice(i.ss + 6, i.s)) : []
      const resolution = {
        isImport: true,
        position: [i.ss, i.s - q, i.e + q],
        input: i.n,
        output: null
      }
      result.resolutions.push(resolution)
      if (names.length) {
        result.namedImports.push({
          names,
          from: resolution
        })
      }
    } else if (i.ss !== i.s) {
      result.resolutions.push({
        isImport: true,
        position: [i.ss, i.s - 1, -1],
        input: null,
        output: null
      })
    }
  }

  if (esm) {
    result.exports = exp
    return result
  }

  for (const req of srp(src)) {
    result.resolutions.push({
      isImport: false,
      position: null,
      input: req,
      output: null
    })
  }

  return result
}

exports.exports = function exports (src, type) {
  if (type === 'module') return mjs.parse(src)[1]
  return type === 'json' ? [] : cjs.parse(src).exports
}

function mjsParse (src) {
  try {
    return mjs.parse(src)
  } catch {
    return [[], []]
  }
}

function parseNames (imp) {
  imp = imp.replace(/\/\/[^n]+/g, '').replace(/\/\*[^*]*\*\//g, '')

  const bs = imp.indexOf('{')
  if (bs === -1) return []
  const be = imp.indexOf('}', bs)
  if (be === -1) return []

  const result = []

  for (const part of imp.slice(bs + 1, be).split(',')) {
    const name = part.split(/\sas\s/)[0].trim()
    if (!name) return []
    result.push(name)
  }

  return result
}
