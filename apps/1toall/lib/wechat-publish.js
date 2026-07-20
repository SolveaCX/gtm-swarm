// 微信公众号发布适配层 —— 骨架，第二期实现。当前没有任何路由 / 调用方接线到这个文件。
// 密钥只从环境变量读，绝不写进代码或 data/：
//   WECHAT_APPID       —— 公众号 AppID
//   WECHAT_APP_SECRET  —— 公众号 AppSecret
//   （命名对齐 ~/shared-skills/md2wechat/WECHAT_PUBLISH_SOP.md 里 md2wechat CLI 的现成约定；
//    兼容读一下 WECHAT_SECRET 作为别名，免得改了名字忘记同步）
//
// 第二期要做的事（现在都是 TODO）：
//   1. getAccessToken()   —— POST https://api.weixin.qq.com/cgi-bin/token 换 access_token
//                            需要处理：40001/42001 过期重取、45009 频率限制、IP 白名单没配的报错提示。
//   2. uploadCoverImage() —— 封面先传素材库换 thumb_media_id（草稿接口不吃裸 url，必须素材库素材）。
//   3. createDraft()      —— POST /cgi-bin/draft/add，content 用 wechat-layout.js 的 renderWechatHtml() 产物；
//                            title ≤32 字、digest ≤128 字（超限直接在这层截断+提示，别让接口 45004）。
//   4. publishDraft()     —— 可选，从草稿箱正式发布；发布是不可逆动作，建议永远人工在公众号后台点，
//                            这里即便实现了也不要在没有明确人工确认的地方自动调用。
//
// 参考 SOP：~/shared-skills/md2wechat/WECHAT_PUBLISH_SOP.md（账号信息 / 排版规范 / 发布流程 / 常见问题）

function credentials() {
  return {
    appId: process.env.WECHAT_APPID || '',
    appSecret: process.env.WECHAT_APP_SECRET || process.env.WECHAT_SECRET || '',
  };
}

// 供前端/后端判断"发布功能现在能不能用"，不抛错、方便直接 if 判断
export function publishConfigured() {
  const { appId, appSecret } = credentials();
  return !!(appId && appSecret);
}

export async function getAccessToken() {
  if (!publishConfigured()) throw new Error('未配置 WECHAT_APPID / WECHAT_APP_SECRET，发布功能还没开通');
  throw new Error('TODO 第二期实现：换取微信 access_token（见文件头注释）');
}

export async function uploadCoverImage(_imagePath) {
  if (!publishConfigured()) throw new Error('未配置 WECHAT_APPID / WECHAT_APP_SECRET，发布功能还没开通');
  throw new Error('TODO 第二期实现：封面图上传素材库换 thumb_media_id');
}

export async function createDraft(_html, _meta) {
  if (!publishConfigured()) throw new Error('未配置 WECHAT_APPID / WECHAT_APP_SECRET，发布功能还没开通');
  throw new Error('TODO 第二期实现：调草稿箱 API 创建公众号草稿');
}
