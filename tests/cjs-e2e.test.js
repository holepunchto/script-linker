const path = require('path')
const test = require('brittle')
const e2e = require('./helpers/e2e')
e2e({ entrypoint: __filename, root: path.join(__dirname, 'fixtures') })

module.exports = async function ({ loader }) {
  test('it should require cjs modules from path to dir', ({ is }) => {
    const exp = loader('./fixtures/cjs-with-exports')
    is(exp, 'an export')
  })

  test('it should require cjs modules from path to file', ({ is }) => {
    const exp = loader('./fixtures/cjs-with-exports/index.js')
    is(exp, 'an export')
  })

  test('it should throw requiring esm modules', ({ exception }) => {
    exception(() => loader('./fixtures/esm-with-exports/index.js'))
  })
}
