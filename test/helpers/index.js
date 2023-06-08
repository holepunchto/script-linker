const ScriptLinker = require('../../index.js')
const Localdrive = require('localdrive')

module.exports = {
  create
}

function create (root) {
  const drive = new Localdrive(root || __dirname)
  return new ScriptLinker(drive)
}
