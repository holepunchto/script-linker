const path = require('path')
const Localdrive = require('localdrive')
const e2e = require('./helpers/e2e')

const minimal = new Localdrive('/')
const cjs = { entrypoint: path.join(__dirname, './cjs-e2e.test.js') }
const esm = { entrypoint: path.join(__dirname, './esm-e2e.test.mjs') }

e2e(esm)
e2e({ ...esm, backend: minimal })
e2e(cjs)
e2e({ ...cjs, backend: minimal })
