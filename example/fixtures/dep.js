console.log('i am cjs dep')
const staticCircular = require('./dep.js')
const runtimeCircular = require('././././' + 'dep.js')
exports.stuff = { name: 'i am dep', staticCircular, runtimeCircular }
