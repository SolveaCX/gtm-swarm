export function selectWizardStepAfterStateRefresh({
  serverCurrentStep = 0,
  currentStep = 1,
  preserveCurrentStep = false,
}) {
  if (preserveCurrentStep) return clampWizardStep(currentStep)
  if (serverCurrentStep >= 4) return 4
  return clampWizardStep(serverCurrentStep + 1)
}

export function formatWizardAgentLabel(agentCount, action) {
  const noun = Number.isFinite(agentCount) && agentCount > 0
    ? `${agentCount} Agents`
    : 'Agents'
  return action ? `${action} ${noun}` : noun
}

function clampWizardStep(step) {
  return Math.min(4, Math.max(1, Number(step) || 1))
}
