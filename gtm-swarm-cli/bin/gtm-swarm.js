#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from '../src/args.js'
import { pushArtifact, pushBatch, pushObservation } from '../src/commands/push.js'
import { runNode } from '../src/commands/node.js'
import { validateTelemetryBatch } from '../src/schema.js'

function usage() {
  console.log(`GTM Swarm CLI

Usage:
  gtm-swarm help
  gtm-swarm validate <file>
  gtm-swarm push batch <file>
  gtm-swarm push artifact --workspace <slug> --agent <key> --platform x --type post --external-id <id> [--url <url>] [--body <text>]
  gtm-swarm push observation --workspace <slug> --agent <key> --platform x --type post --external-id <id> --metric views=123 --metric replies=4
  gtm-swarm node run --workspace <slug> --agent <key> --node <node-id> --handler ./collect-x.js [--once]

Environment:
  GTM_SWARM_SERVER     default http://localhost:8082
  GTM_SWARM_TOKEN      bearer token
  GTM_SWARM_WORKSPACE  default workspace
  GTM_SWARM_AGENT      default agent key
  GTM_SWARM_NODE       default node id`)
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const [command, subcommand, target] = positional

  if (!command || command === 'help') {
    usage()
    return
  }

  if (command === 'validate') {
    const file = subcommand
    if (!file) throw new Error('validate requires a file')
    const json = JSON.parse(await readFile(file, 'utf-8'))
    const result = validateTelemetryBatch(json)
    if (!result.ok) throw new Error(result.error)
    console.log('valid')
    return
  }

  if (command === 'push' && subcommand === 'batch') {
    if (!target) throw new Error('push batch requires a file')
    await pushBatch(target)
    return
  }

  if (command === 'push' && subcommand === 'artifact') {
    await pushArtifact(flags)
    return
  }

  if (command === 'push' && subcommand === 'observation') {
    await pushObservation(flags)
    return
  }

  if (command === 'node' && subcommand === 'run') {
    await runNode(flags)
    return
  }

  usage()
  process.exitCode = 1
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
