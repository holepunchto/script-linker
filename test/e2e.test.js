const { readFile } = require('fs/promises')
const path = require('path')
const e2e = require('./helpers/e2e')

const minimal = { readFile }
const cjs = { entrypoint: path.join(__dirname, './cjs-e2e.test.js') }
e2e(cjs)
e2e({ ...cjs, backend: minimal })
