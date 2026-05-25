export function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      flags[key] = true
      continue
    }
    if (flags[key] === undefined) flags[key] = next
    else if (Array.isArray(flags[key])) flags[key].push(next)
    else flags[key] = [flags[key], next]
    i += 1
  }
  return { positional, flags }
}

export function flag(flags, name, fallback = '') {
  return flags[name] ?? fallback
}

export function listFlag(flags, name) {
  const value = flags[name]
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export function parseMetricFlags(values) {
  const metrics = {}
  for (const item of values) {
    const [key, raw] = String(item).split('=')
    const value = Number(raw)
    if (!key || !Number.isFinite(value)) throw new Error(`invalid metric: ${item}`)
    metrics[key] = value
  }
  return metrics
}
