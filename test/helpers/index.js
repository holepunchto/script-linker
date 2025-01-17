const ScriptLinker = require('../../index.js')
const Localdrive = require('localdrive')

module.exports = {
  create
}

function create (root, opts) {
  const drive = new Localdrive(root || __dirname)
  return new ScriptLinker(drive, opts)
}
