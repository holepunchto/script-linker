const { BrowserWindow, app, protocol, ipcMain } = require('electron')
const { Readable } = require('stream')
const path = require('path')
const fs = require('fs')
const ScriptLinker = require('../')

app.commandLine.appendSwitch('disable-http-cache')

let webContents = null

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true } }
])

let id = 0
const pending = new Map()

ipcMain.on('warmup', function (sender, id, batch) {
  const [resolve, reject] = pending.get(id)
  pending.delete(id)
  console.log('recv batch reply (length = ' + batch.length + ')')
  if (batch) resolve(batch)
  else reject(new Error('could not warmup modules'))
})

const s = new ScriptLinker({
  builtins: require('./builtins'),
  warmup (batch) {
    return new Promise((resolve, reject) => {
      console.log('sending batch (length = ' + batch.length + ')')
      id++
      pending.set(id, [resolve, reject])
      webContents.send('warmup', id, batch)
    })
  },
  readFile (name) {
    return fs.promises.readFile(path.join(__dirname, 'fixtures', name))
  }
})

app.on('ready', function () {
  let sendWarmup = null

  protocol.registerStreamProtocol('app', async (request, reply) => {
    console.log('serving', request.url)
    if (request.url.endsWith('/index.html')) {
      sendWarmup = null

      const out = await fs.promises.readFile(path.join(__dirname, 'fixtures/index.html'))
      const data = new Readable({
        read () {
          data.push(out)
          data.push(null)
        }
      })

      reply({
        statusCode: 200,
        headers: { 'Content-Type': 'text/html' },
        data
      })
      return
    }

    if (sendWarmup === null) {
      console.log('reset warmup')
      sendWarmup = s.warmup('/index.html')
    }

    const u = ScriptLinker.link.parse(request.url)
    if (u.transform === 'app' && request.url.endsWith('.js')) u.transform = 'esm'

    // before sending any esm, make sure we warmup the cjs
    if (u.transform === 'esm') await sendWarmup

    const type = u.transform === 'map' ? 'application/json' : 'application/javascript'

    const out = await s.transform(u)

    const data = new Readable({
      read () {
        data.push(out)
        data.push(null)
      }
    })

    reply({
      statusCode: 200,
      headers: { 'Content-Type': type, Pragma: 'no-cache' },
      data
    })
  })

  protocol.registerStreamProtocol('resolve', async function (request, reply) {
    const u = ScriptLinker.link.parse(request.url)
    const r = u.filename || await s.resolve(u.resolve, u.dirname, { transform: u.transform })

    const data = new Readable({
      read () {
        data.push(r)
        data.push(null)
      }
    })

    reply({
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

  webContents = win.webContents
  win.webContents.on('did-finish-load', () => {
    win.webContents.openDevTools({ mode: 'detach' })
  })

  win.webContents.loadURL('app://app/index.html')
})
