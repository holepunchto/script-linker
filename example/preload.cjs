const runtime = require('../runtime')
const link = require('../link')
const { ipcRenderer } = require('electron')

const s = runtime({
  builtins: require('./builtins'),
  getSync,
  resolveSync (resolve, dirname, { isImport }) {
    return getSync(link.stringify({ protocol: 'resolve', transform: isImport ? 'esm' : 'cjs', resolve, dirname }))
  }
})

ipcRenderer.on('warmup', function (sender, id, batch) {
  const result = s.warmup(batch)
  ipcRenderer.send('warmup', id, result)
})

global.require = s.require

function getSync (url) {
  const xhr = new XMLHttpRequest() // eslint-disable-line no-undef

  xhr.open('GET', url, false)
  xhr.send(null)

  if (xhr.statusText !== 'OK') throw new Error('Get failed')
  return xhr.responseText
}
