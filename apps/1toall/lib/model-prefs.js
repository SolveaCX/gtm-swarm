// 模型偏好：设置页选什么，生产线就用什么（workspace 级，存 settings.json 的 models 字段）。
// 没配置时回退到 config.js 的默认值——保存即生效，不用重启。
import { wsSettings } from './store.js';

export function modelPref(key, fallback) {
  const v = ((wsSettings.get() || {}).models || {})[key];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}
