import { pathToFileURL } from 'node:url'
import { flag } from '../args.js'
import { encodeQuery, requestJson } from '../client.js'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function runNode(flags) {
  const workspace = flag(flags, 'workspace', process.env.GTM_SWARM_WORKSPACE || '')
  const agent_key = flag(flags, 'agent', process.env.GTM_SWARM_AGENT || '')
  const node_id = flag(flags, 'node', process.env.GTM_SWARM_NODE || 'local')
  const handlerPath = flag(flags, 'handler')
  const once = Boolean(flags.once)
  const intervalMs = Number(flag(flags, 'interval-ms', '5000'))

  if (!workspace) throw new Error('--workspace or GTM_SWARM_WORKSPACE required')
  if (!agent_key) throw new Error('--agent or GTM_SWARM_AGENT required')
  if (!handlerPath) throw new Error('--handler required')

  const handlerModule = await import(pathToFileURL(handlerPath).href)
  if (typeof handlerModule.handleJob !== 'function') throw new Error('handler must export async function handleJob(job)')

  while (true) {
    const qs = encodeQuery({ workspace, agent_key, node_id })
    const lease = await requestJson(`/api/swarm/jobs/lease?${qs}`)
    if (!lease.job) {
      if (once) {
        console.log(JSON.stringify({ job: null }, null, 2))
        return
      }
      await sleep(intervalMs)
      continue
    }

    console.log(JSON.stringify({ leased: lease.job.id, kind: lease.job.kind }, null, 2))
    let completion
    try {
      completion = await handlerModule.handleJob(lease.job)
    } catch (error) {
      completion = {
        status: 'failed',
        summary: error instanceof Error ? error.message : String(error),
        error: 'handler_error',
      }
    }
    const result = await requestJson(`/api/swarm/jobs/${lease.job.id}/complete`, {
      method: 'POST',
      body: completion,
    })
    console.log(JSON.stringify(result, null, 2))
    if (once) return
  }
}
