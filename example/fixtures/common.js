console.log('from ./common.js')

exports.foo = 'foo'
exports.bar = 'bar'
exports['ba' + 'z'] = 'baz'
exports.unix = require('unix-path-resolve')
exports.common = require('./common')
exports.hypercore = require('hypercore')
