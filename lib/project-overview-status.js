export function getProjectOverviewCta({
  contentosState = 'not_started',
  currentStep = 0,
  stepsDone = 0,
  slug,
}) {
  if (contentosState === 'built') return { show: false }

  const completed = Math.max(Number(currentStep) || 0, Number(stepsDone) || 0)
  if (completed >= 4) {
    return {
      show: true,
      href: '#strategy-briefs',
      label: 'View Results →',
    }
  }

  if (completed <= 0) {
    return {
      show: true,
      href: `/wizard/${slug}`,
      label: 'Start Discovery →',
    }
  }

  return {
    show: true,
    href: `/wizard/${slug}`,
    label: `Resume Wizard (Step ${Math.min(4, completed + 1)}/4)`,
  }
}
