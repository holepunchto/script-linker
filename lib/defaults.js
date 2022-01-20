let builtinModules = null

exports.compile = require('./compile')

exports.map = defaultMap

exports.mapImport = defaultMapImport

exports.type = 'commonjs'

exports.userspace = 'app'

exports.symbol = 'scriptlinker'

exports.protocols = {
  app: 'app',
  esm: 'esm',
  cjs: 'cjs'
}

exports.linkSourceMaps = true

exports.cacheSize = 512

exports.builtins = {
  has (req) {
    if (builtinModules === null) builtinModules = require('module').builtinModules
    return builtinModules.includes(req)
  },
  get (req) {
    return require(req)
  },
  keys () {
    if (builtinModules === null) builtinModules = require('module').builtinModules
    return builtinModules
  }
}

function defaultMap (id, { userspace, protocols, isImport, isBuiltin, isSourceMap, isConsole }) {
  const protocol = isConsole ? protocols.app : (isImport ? protocols.esm : protocols.cjs)
  return protocol + '://' + (isBuiltin ? '' : userspace) + id + (isSourceMap ? '.map' : '')
}

function defaultMapImport (link, dirname) {
  return link
}
