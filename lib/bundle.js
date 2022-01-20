module.exports = async function bundle (s, filename, { builtins } = {}) {
  if (!s.bare) throw new Error('Bundling only works in bare mode')

  let cjs = []
  let esm = ''
  let main = null
  let out = '{\n'

  for await (const { isImport, module } of s.dependencies(filename)) {
    if (main === null) main = module
    if (isImport === false || module.builtin || module.type === 'commonjs') {
      cjs.push(module)
    }
    if (isImport) {
      if (esm) esm += ',\n'
      esm += '    ' + JSON.stringify('bundle:' + module.filename) + ': '
      esm += JSON.stringify('data:application/javascript;base64,' + Buffer.from(module.toESM()).toString('base64'))
    }
  }

  if (esm) esm += '\n'

  if (esm) {
    out += '{\n  const im = document.createElement(\'script\')\n'
    out += '  im.type = \'importmap\'\n'
    out += '  im.textContent = JSON.stringify({ imports: {\n'
    out += esm
    out += '  }})\n'
    out += '  document.currentScript.before(im)\n}\n'
  }

  if (cjs.length) {
    cjs = [...new Set(cjs)] // no dups
    out += 'require.cache = {\n'
    for (let i = cjs.length - 1; i >= 0; i--) {
      const e = (cjs[i].builtin && builtins) ? builtins + '.get(' + JSON.stringify(cjs[i].filename) + ')' : '{}'
      out += '  ' + JSON.stringify(cjs[i].filename) + ': { exports: ' + e + ' }' + (i === 0 ? '' : ',') + '\n'
    }
    out += '}\n'
    out += 'require.scope = function (map, fn) {\n'
    out += '  scopedRequire.cache = require.cache\n'
    out += '  fn(scopedRequire)\n'
    out += '  function scopedRequire (req) {\n'
    out += '    if (!map.hasOwnProperty(req)) throw new Error("Cannot require \'" + req + "\'")\n'
    out += '    return require(map[req])\n'
    out += '  }\n'
    out += '}\n'
    for (let i = cjs.length - 1; i >= 0; i--) {
      const mod = cjs[i]
      if (mod.builtin) continue
      const map = mod.requireMap() || {}
      out += 'require.scope(' + JSON.stringify(map) + ', function (require, '
      out += '__filename = ' + JSON.stringify(mod.filename) + ', '
      out += '__dirname = ' + JSON.stringify(mod.dirname) + ', '
      out += 'module = require.cache[' + JSON.stringify(mod.filename) + ']) {\n'
      out += mod.toCJS()
      out += '})\n'
    }
    out += 'function require (req) {\n'
    out += '  if (!require.cache.hasOwnProperty(req)) throw new Error("Cannot require \'" + req + "\'")\n'
    out += '  return require.cache[req].exports\n'
    out += '}\n'
  }

  if (main.type === 'module') {
    out += 'import(' + JSON.stringify('bundle:' + main.filename) + ')\n'
  }

  out += '}\n'
  return out
}
