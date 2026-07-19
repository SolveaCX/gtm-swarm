// 把生成的平台文案拆成 {title, body, tags} 三段，供渠道页分段复制。
// 兼容中文文案（【标题】/标题：/首行做标题 + 行内 #tag）和英文（Title:/Description:/Tags:）。

const TAG_RE = /#[^\s#，。,]+/g;

export function splitCopy(text) {
  if (!text || typeof text !== 'string') return { title: '', body: '', tags: '' };
  const raw = text.trim();
  let title = '';
  let tags = [];
  let bodyLines = [];

  const lines = raw.split('\n');
  const labeled = { title: null, body: [], tags: null, desc: [] };
  let section = null;
  for (const line of lines) {
    const l = line.trim();
    const mHeading = /^#{1,6}\s*(标题|Title|Tags?|话题|标签|正文|Description|内容|简介)\s*(?:[:：]\s*(.*))?$/i.exec(l);
    if (mHeading) {
      const label = mHeading[1].toLowerCase();
      const value = (mHeading[2] || '').trim();
      if (/^(标题|title)$/.test(label)) {
        section = 'title';
        if (value) labeled.title = value;
      } else if (/^(tags?|话题|标签)$/.test(label)) {
        section = 'tags';
        labeled.tags = (labeled.tags || '') + ' ' + value;
      } else {
        section = 'body';
        if (value) labeled.body.push(value);
      }
      continue;
    }
    // 显式分段标记（中英）
    const mTitle = /^(?:【?标题】?|Title)\s*[:：]\s*(.*)$/i.exec(l);
    const mTags = /^(?:【?(?:tags?|话题|标签)】?|Tags?)\s*[:：]\s*(.*)$/i.exec(l);
    const mBody = /^(?:【?正文】?|Description|内容)\s*[:：]\s*(.*)$/i.exec(l);
    if (mTitle) { section = 'title'; if (mTitle[1]) labeled.title = mTitle[1].trim(); continue; }
    if (mTags) { section = 'tags'; labeled.tags = (labeled.tags || '') + ' ' + (mTags[1] || ''); continue; }
    if (mBody) { section = 'body'; if (mBody[1]) labeled.body.push(mBody[1]); continue; }
    if (section === 'title' && l && labeled.title == null) { labeled.title = l; section = 'body'; continue; }
    if (section === 'tags') { labeled.tags = (labeled.tags || '') + ' ' + l; continue; }
    if (section === 'body') { labeled.body.push(line); continue; }
    if (section === null) labeled.desc.push(line);
  }

  if (labeled.title != null) {
    // 有显式标记：按标记走
    title = labeled.title;
    const bodySrc = (labeled.body.length ? labeled.body : labeled.desc).join('\n').trim();
    tags = labeled.tags ? labeled.tags.match(TAG_RE) || labeled.tags.trim().split(/\s+/).filter(Boolean) : bodySrc.match(TAG_RE) || [];
    let body = bodySrc;
    // 正文里把纯 tag 行剔掉
    body = body
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        if (!t) return true;
        const tagsIn = t.match(TAG_RE) || [];
        return !(tagsIn.length >= 2 && tagsIn.join('').length > t.length * 0.6);
      })
      .join('\n')
      .trim();
    return { title: cleanTitle(title), body, tags: normalizeTags(tags) };
  }

  // 无显式标记：首个非空行当标题（去掉 markdown # 和引号），行内 #tag 汇总
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  title = nonEmpty[0] || '';
  let started = false;
  for (const line of lines) {
    const t = line.trim();
    if (!started) {
      if (t === nonEmpty[0]) { started = true; continue; }
      continue;
    }
    const tagsIn = t.match(TAG_RE) || [];
    if (tagsIn.length >= 2 && tagsIn.join('').length > t.length * 0.6) { tags.push(...tagsIn); continue; }
    bodyLines.push(line);
  }
  const body = bodyLines.join('\n').trim();
  if (!tags.length) tags = raw.match(TAG_RE) || [];
  return { title: cleanTitle(title), body, tags: normalizeTags(tags) };
}

function cleanTitle(t) {
  return String(t).replace(/^#+\s*/, '').replace(/^[「『"']|[」』"']$/g, '').trim();
}
function normalizeTags(arr) {
  const seen = new Set();
  const out = [];
  for (const t of Array.isArray(arr) ? arr : []) {
    const k = String(t).trim();
    if (k && !seen.has(k)) { seen.add(k); out.push(k.startsWith('#') ? k : '#' + k); }
  }
  return out.join(' ');
}
