let builtinModules = null

const extra = ['sodium-native', 'quickbit-native', 'crc-native', 'fs-native-extensions', 'simdle-native']

module.exports = {
  has (req) {
    if (builtinModules === null) builtinModules = (require('module').builtinModules || []).concat(extra)
    return builtinModules.includes(req)
  },
  get (req) {
    // in case someone injects a different builtin require (ie boot-drive), support that
    return (require.builtinRequire || require)(req)
  },
  keys () {
    if (builtinModules === null) builtinModules = (require('module').builtinModules || []).concat(extra)
    return builtinModules.concat()
  }
}
