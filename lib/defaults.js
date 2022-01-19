let builtinModules = null

exports.compile = require('./compile')

exports.map = defaultMap

exports.mapImport = defaultMapImport

exports.type = 'commonjs'

exports.userspace = 'app'

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

function defaultMap (id, { userspace, isImport, isBuiltin, isSourceMap, isConsole }) {
  const protocol = isConsole ? 'app' : (isImport ? 'esm' : 'cjs')
  return protocol + '://' + (isBuiltin ? '' : userspace) + id + (isSourceMap ? '.map' : '')
}

function defaultMapImport (link, dirname) {
  return link
}
