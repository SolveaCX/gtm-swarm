// 输出类型注册表：「想法可以变成什么」
// group: text 文字 / image 图片 / video 视频
// kind:  text 纯文字结果 / image 出图 / plan 文字方案
export const PLATFORMS = [
  // ---------- 文字 ----------
  { id: 'article',      group: 'text',  kind: 'text',  emoji: '📄', label: '通用文章',     hint: '结构完整的深度长文' },
  { id: 'gongzhonghao', group: 'text',  kind: 'text',  emoji: '📰', label: '公众号推文',   hint: '标题+正文，带情绪钩子' },
  { id: 'gongzhonghao_pub', group: 'text', kind: 'article_layout', emoji: '🗞️', label: '公众号成品文', hint: '带排版+配图，可直接发' },
  { id: 'xiaohongshu',  group: 'text',  kind: 'text',  emoji: '📕', label: '小红书图文',   hint: '爆款标题+正文+话题标签' },
  { id: 'douyin',       group: 'text',  kind: 'text',  emoji: '🎬', label: '抖音口播脚本', hint: '黄金3秒开场+口播逐字稿' },
  { id: 'shipinhao',    group: 'text',  kind: 'text',  emoji: '📺', label: '视频号文案',   hint: '简短有力，适合熟人传播' },
  { id: 'twitter',      group: 'text',  kind: 'text',  emoji: '🐦', label: 'X / 推特',     hint: '英文 thread，几条连发' },

  // ---------- 图片 ----------
  { id: 'peitu',        group: 'image', kind: 'image', emoji: '🖼️', label: '横版配图',     hint: '16:9 文章/PPT 配图', size: '1536x1024', aspect: '16:9' },
  { id: 'cover',        group: 'image', kind: 'image', emoji: '🎴', label: '竖版封面',     hint: '3:4 小红书/公众号封面', size: '1024x1536', aspect: '3:4' },
  { id: 'changtu',      group: 'image', kind: 'image', emoji: '📜', label: '长图海报',     hint: '9:16 竖屏信息海报', size: '1024x1536', aspect: '9:16' },

  // ---------- 视频（方案） ----------
  { id: 'video_plan',   group: 'video', kind: 'plan',  emoji: '🎥', label: '视频脚本方案', hint: '口播稿+分镜+封面+三平台文案' },
  { id: 'bilibili',     group: 'video', kind: 'text',  emoji: '📀', label: 'B站长视频脚本', hint: '6-8分钟横屏中文讲师风' },
  { id: 'youtube_long', group: 'video', kind: 'text',  emoji: '▶️', label: 'YouTube长视频脚本', hint: '10分钟横屏英文' },
  { id: 'shorts_en',    group: 'video', kind: 'text',  emoji: '🌍', label: '海外短视频脚本', hint: '1分钟竖屏英文 · TK/Shorts 通用' },
];

export const GROUPS = [
  { id: 'text',  label: '文字', emoji: '✍️' },
  { id: 'image', label: '图片', emoji: '🎨' },
  { id: 'video', label: '视频', emoji: '🎬' },
];

export function getPlatform(id) {
  return PLATFORMS.find((p) => p.id === id) || null;
}
