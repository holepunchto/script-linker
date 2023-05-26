const { readFile } = require('fs/promises')
const path = require('path')
const e2e = () => {} // TODO: require('./helpers/e2e')

const minimal = { readFile } // TODO: { drive: new Localdrive(__dirname) }
const cjs = { entrypoint: path.join(__dirname, './cjs-e2e.test.js') }
const esm = { entrypoint: path.join(__dirname, './esm-e2e.test.mjs') }

e2e(esm)
e2e({ ...esm, backend: minimal })
e2e(cjs)
e2e({ ...cjs, backend: minimal })
