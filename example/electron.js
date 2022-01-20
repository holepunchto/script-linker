const { BrowserWindow, app, protocol } = require('electron')
const { Readable } = require('stream')
const path = require('path')
const fs = require('fs')
const ScriptLinker = require('../')
const { URL } = require('url')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true }}
])

const s = new ScriptLinker({
  readFile (name) {
    return fs.promises.readFile(path.join(__dirname, 'fixtures', name))
  }
})

app.on('ready', function () {
  protocol.registerStreamProtocol('app', async (request, callback) => {
    const u = ScriptLinker.link.parse(request.url)
    const type = u.transform === 'map' ? 'application/json' : 'application/javascript'

    const out = await s.transform(u)

    const data = new Readable({
      read () {
        data.push(out)
        data.push(null)
      }
    })

    callback({
      statusCode: 200,
      headers: { 'Content-Type': type },
      data
    })
  })

  protocol.registerStreamProtocol('resolve', async function (request, callback) {
    const u = ScriptLinker.link.parse(request.url)
    const r = u.filename || await s.resolve(u.resolve, u.dirname, { transform: u.transform })

    const data = new Readable({
      read () {
        data.push(r)
        data.push(null)
      }
    })

    callback({
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      data
    })
  })

  const win = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInWorker: true,
      nodeIntegrationInSubFrames: false,
      enableRemoteModule: true
    }
  })

  win.webContents.on('did-finish-load', () => {
    win.webContents.openDevTools({ mode: 'detach' })
  })

  win.webContents.loadURL('file://' + path.join(__dirname, 'fixtures/index.html'))
})
