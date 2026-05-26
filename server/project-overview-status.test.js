import test from 'node:test'
import assert from 'node:assert/strict'

import { getProjectOverviewCta } from '../lib/project-overview-status.js'

test('shows a view-results CTA instead of step 5 when discovery is complete', () => {
  const cta = getProjectOverviewCta({
    contentosState: 'step_1_done',
    currentStep: 4,
    stepsDone: 4,
    slug: 'voc-ai',
  })

  assert.deepEqual(cta, {
    show: true,
    href: '#strategy-briefs',
    label: 'View Results →',
  })
})

test('clamps resume wizard CTA to the next valid unfinished step', () => {
  assert.equal(getProjectOverviewCta({
    contentosState: 'step_2_done',
    currentStep: 2,
    stepsDone: 2,
    slug: 'voc-ai',
  }).label, 'Resume Wizard (Step 3/4)')
})

test('hides the CTA after the swarm is built', () => {
  assert.deepEqual(getProjectOverviewCta({
    contentosState: 'built',
    currentStep: 4,
    stepsDone: 4,
    slug: 'voc-ai',
  }), { show: false })
})
