import module from 'module'

export async function resolve (specifier, context, defaultResolve) {
  try {
    if (module.builtinModules.includes(specifier)) return defaultResolve(specifier, context)
    const { _rpc } = global[Symbol.for('scriptlinker')]
    return _rpc.request('resolveESM', { specifier, context })
  } catch {
    return defaultResolve(specifier, context)
  }
}

export async function load (url, context, defaultLoad) {
  try {
    if (/^node:/.test(url)) return defaultLoad(url, context, defaultLoad)
    const { _rpc } = global[Symbol.for('scriptlinker')]
    return _rpc.request('getESM', { url, context })
  } catch {
    return defaultLoad(url, context, defaultLoad)
  }
}