import test from 'brittle'
import ScriptLinker from '../index.js'

test('it should preload with bad resolve and get', async ({ is }) => {
  const linker = ScriptLinker.preload({
    resolveSync (...args) {
      console.log('resolve sync', args)
      return null
    },
    getSync (...args) {
      console.log('get sync', args)
      return null
    }
  })
  is(linker, global[Symbol.for('scriptlinker')])
})
