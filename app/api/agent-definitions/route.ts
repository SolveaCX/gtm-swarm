import { NextRequest, NextResponse } from 'next/server'
import { listAgentDefinitions, agentRegistryForPrompt } from '@/server/agent-registry.js'

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get('format')
  const includeDisabled = request.nextUrl.searchParams.get('include_disabled') === '1'

  if (format === 'prompt') {
    return NextResponse.json({ agents: agentRegistryForPrompt() })
  }

  const agents = listAgentDefinitions({ enabledOnly: !includeDisabled })
  return NextResponse.json({
    count: agents.length,
    agents,
    note: 'File-based registry (server/agent-registry.js). Eventual destination: agent_definitions DB table per migration 003.',
  })
}
