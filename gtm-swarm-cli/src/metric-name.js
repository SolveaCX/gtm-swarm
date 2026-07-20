export const SAFE_METRIC_NAME = /^[a-z][a-z0-9_]{0,63}$/

export function isSafeMetricName(value) {
  return typeof value === 'string' && SAFE_METRIC_NAME.test(value)
}
