module.exports = find

function find (src) {
  const r = []

  let i = src.indexOf('require')
  let j = i > -1 ? src.indexOf('/*') : -1

  while (i > -1) {
    if (j > -1 && i > j) {
      j = src.indexOf('*/', j + 2)
      if (j === -1) continue
      if (i < j) i = src.indexOf('require', j + 2)
      j = src.indexOf('/*', j + 2)
      continue
    }

    if (newWord(src, i) && !inComment(src, i)) {
      const m = src.slice(i + 7).match(/^\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*\)/)
      if (m) {
        const req = m[1].slice(1, -1)
        if (r.indexOf(req) === -1) r.push(req)
      }
    }

    i = src.indexOf('require', i + 7)
  }

  return r
}

function newWord (src, i) {
  const s = i > 0 ? src.slice(i - 1, i) : ''
  return !/^\w|["'`.]/.test(s)
}

function inComment (src, i) {
  const pre = src.slice(i > 100 ? i - 100 : 0, i)
  return pre.indexOf('//', Math.max(pre.lastIndexOf('\n'), 0)) > -1 && src.slice(i, i + 100).indexOf('\n') > -1
}
