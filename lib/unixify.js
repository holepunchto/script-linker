// TODO: handle special cases like https://github.com/sindresorhus/slash/blob/main/index.js
// NOTE: can't use that module because ESM
module.exports = (str) => {
  if (process.platform === 'win32') return str.replace(/\\/g, '/')
  return str
}
