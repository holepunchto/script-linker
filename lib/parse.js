const mjs = require('es-module-lexer')
const cjs = require('cjs-module-lexer')
const srp = require('./sloppy-require-parser')

exports.init = async function init () {
  await mjs.init
  await cjs.init()
}

exports.parse = function parse (src, type = 'module', strictMode = true) {
  const [imp, exp] = mjs.parse(src)

  const result = {
    type,
    resolutions: [],
    exports: null
  }

  if (type === 'json') {
    result.exports = { default: true, named: [] }
    return result
  }

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

    const q = (i.d > -1 ? 0 : 1)

    result.resolutions.push({
      isImport: true,
      position: [i.ss, i.s - q, i.e + q],
      input: i.n,
      output: null
    })
  }

  if (esm) {
    result.exports = formatESMExports(exp)
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
  if (type === 'module') return formatESMExports(mjs.parse(src)[1])

  return {
    default: true,
    named: type === 'json' ? [] : cjs.parse(src).exports
  }
}

function formatESMExports (exp) {
  const result = {
    default: false,
    named: []
  }

  for (const e of exp) {
    if (e === 'default') result.default = true
    else result.named.push(e)
  }

  return result
}
