const dep = 'dep-c'
const depA = require('./lib/dep-a')
const depB = require('./lib/dep-b')
const depC = require('./lib' + dep)

console.log(depA.name, depB(), depC)
