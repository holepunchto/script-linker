const runtime = require('../runtime')
const link = require('../link')

const s = runtime({
  getSync,
  resolveSync (resolve, dirname, { isImport }) {
    return getSync(link.stringify({ protocol: 'resolve', transform: isImport ? 'esm' : 'cjs', resolve, dirname }))
  }
})

global.require = s.require

function getSync (url) {
  const xhr = new XMLHttpRequest()

  xhr.open('GET', url, false)
  xhr.send(null)

  if (xhr.statusText !== 'OK') throw new Error('Get failed')
  return xhr.responseText
}
