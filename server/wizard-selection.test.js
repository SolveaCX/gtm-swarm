import test from 'node:test'
import assert from 'node:assert/strict'

import { formatWizardAgentLabel, selectWizardStepAfterStateRefresh } from '../lib/wizard-selection.js'

test('preserves current wizard step after a run refresh completes', () => {
  const selected = selectWizardStepAfterStateRefresh({
    serverCurrentStep: 1,
    currentStep: 1,
    preserveCurrentStep: true,
  })

  assert.equal(selected, 1)
})

test('selects the next unfinished step on initial wizard load', () => {
  const selected = selectWizardStepAfterStateRefresh({
    serverCurrentStep: 1,
    currentStep: 1,
    preserveCurrentStep: false,
  })

  assert.equal(selected, 2)
})

test('formats wizard agent labels from registered agent count', () => {
  assert.equal(formatWizardAgentLabel(7, 'Build'), 'Build 7 Agents')
  assert.equal(formatWizardAgentLabel(7, ''), '7 Agents')
  assert.equal(formatWizardAgentLabel(null, 'Build'), 'Build Agents')
  assert.equal(formatWizardAgentLabel(null, ''), 'Agents')
})
