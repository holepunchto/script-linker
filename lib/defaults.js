let builtinModules = null

exports.compile = require('./compile')

exports.map = defaultMap

exports.importMap = defaultImportMap

exports.type = 'commonjs'

exports.userspace = '-'

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

function defaultMap (id, { isImport, isBuiltin, isSourceMap }) {
  return (isImport ? 'module://' : 'commonjs://') + (isBuiltin ? '' : exports.userspace) + id + (isSourceMap ? '.map' : '')
}

function defaultImportMap (link, dirname) {
  return link
}
