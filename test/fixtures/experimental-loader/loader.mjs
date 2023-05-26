import module from 'module'

export async function resolve (specifier, context, defaultResolve) {
  try {
    if (module.builtinModules.includes(specifier)) return defaultResolve(specifier, context)
    const { _rpc } = global[Symbol.for('scriptlinker')]
    const reply = { ...(await _rpc.request('resolveESM', { specifier, context })), shortCircuit: true }
    if (!reply.url.includes(':')) reply.url = new URL('file://' + reply.url).href
    return reply
  } catch {
    return defaultResolve(specifier, context)
  }
}

export async function load (url, context, defaultLoad) {
  if (url.startsWith('file:')) url = new URL(url).href
  try {
    if (/^node:/.test(url)) return defaultLoad(url, context, defaultLoad)
    const { _rpc } = global[Symbol.for('scriptlinker')]
    const reply = { ...(await _rpc.request('getESM', { url, context })), shortCircuit: true }
    return reply
  } catch {
    return defaultLoad(url, context, defaultLoad)
  }
}
