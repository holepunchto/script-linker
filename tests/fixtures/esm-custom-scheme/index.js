import fileDep from 'file://./lib/dep.js' // nothing happens even though resolveable
import staticDep1 from 'protocol:///dep/dep/goose/index.js'
import staticDep2 from 'protocol:dep/dep/goose/index.js'
import depFtp from 'ftp://server.ftp.com/dep/dep/goose/index.js'
import depHttp from 'http://www.cdn.com/dep/dep/goose/index.js'
import depHttps from 'https://www.cdn.com/dep/dep/goose/index.js'
const dynDep1 = await import('protocol://dep/dep/goose/index.js')
const dynDep2= await import('protocol:dep/dep/goose/index.js')
console.log(
  dep,
  fileDep,
  staticDep1,
  staticDep2,
  ftpDep,
  httpDep,
  httpsDep,
  dynDep1,
  dynDep2
)