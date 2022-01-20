let builtinModules = null

exports.compile = require('./lib/compile')

exports.map = defaultMap

exports.mapImport = defaultMapImport

exports.type = 'commonjs'

exports.symbol = 'scriptlinker'

exports.protocol = 'app'

exports.linkSourceMaps = true

exports.cacheSize = 512

exports.builtins = {
  has (req) {
    if (builtinModules === null) builtinModules = require('module').builtinModules || []
    return builtinModules.includes(req)
  },
  get (req) {
    return require(req)
  },
  keys () {
    if (builtinModules === null) builtinModules = require('module').builtinModules || []
    return builtinModules
  }
}

function defaultMap (id, { protocol, isImport, isBuiltin, isSourceMap, isConsole }) {
  const type = isConsole ? 'app' : (isSourceMap ? 'map' : isImport ? 'esm' : 'cjs')
  return protocol + '://' + type + (isBuiltin ? '/~' : '') + id
}

function defaultMapImport (link, dirname) {
  return link
}
