// 出口质检：扫 AI 套话 / 禁用词。
// 理念（来自真人运营调研）：出口处的质检关，比入口 prompt 更值钱——
// 让平庸初稿在出口被规则挡住，运营才敢「复制即发」。
// 命中不代表一定坏，只是「值得运营扫一眼」的提示。

// 硬禁用词（示例）。每条带正则。
const BANNED = [
  { term: '赋能', re: /赋能/g },
  { term: '抓手', re: /抓手/g },
  { term: '闭环', re: /闭环/g },
  { term: '综上所述', re: /综上所述/g },
  { term: '总而言之', re: /总而言之/g },
  { term: '众所周知', re: /众所周知/g },
  { term: '毋庸置疑', re: /毋庸置疑/g },
  { term: '值得一提的是', re: /值得一提的是/g },
  { term: '在当今/这个时代', re: /在(当今|这个)[^，。,.\n]{0,8}(时代|社会|背景下)/g },
  { term: '随着……的发展', re: /随着[^，。,.\n]{0,16}(的发展|的不断|的到来)/g },
  { term: '不仅……更/还', re: /不仅[^，。,.\n]{0,24}(更|还)[^，。,.\n]{0,16}/g },
  { term: '首先……其次（八股）', re: /首先[\s\S]{0,60}其次[\s\S]{0,60}(最后|再次)/g },
  { term: '数字化转型/赋能', re: /数字化(转型|赋能|升级)/g },
  { term: '一言以蔽之', re: /一言以蔽之/g },
  { term: '让我们一起', re: /让我们一起/g },
];

// extraTerms：品牌专属禁用词（字符串数组），命中也算
export function checkQuality(text, extraTerms = []) {
  if (!text || typeof text !== 'string') return { passed: true, flags: [] };
  const flags = [];
  for (const b of BANNED) {
    const m = text.match(b.re);
    if (m && m.length) flags.push({ term: b.term, count: m.length });
  }
  for (const t of extraTerms) {
    const term = String(t).trim();
    if (!term) continue;
    const count = text.split(term).length - 1;
    if (count > 0) flags.push({ term, count, brand: true });
  }
  return { passed: flags.length === 0, flags };
}

// 批量差异化检查：多条文本开头是否雷同（前 N 字高度重合）
export function checkOpeningDiversity(texts) {
  const heads = texts.filter(Boolean).map((t) => t.replace(/^[#\s*【\[]+/, '').slice(0, 12));
  const dupes = [];
  for (let i = 0; i < heads.length; i++)
    for (let j = i + 1; j < heads.length; j++) {
      const a = heads[i], b = heads[j];
      if (a && b && (a.slice(0, 8) === b.slice(0, 8))) dupes.push([i, j]);
    }
  return { diverse: dupes.length === 0, dupes };
}
