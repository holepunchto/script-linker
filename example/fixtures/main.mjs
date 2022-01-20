import foo from './foo.mjs'
import dep from './dep.js'
import dyn from './dyn.mjs'
import b from './b.mjs'
import unix from 'unix-path-resolve'
import './folder/test.mjs'
import './a b.mjs'

console.log({ foo, dep, dyn, b, unix })
