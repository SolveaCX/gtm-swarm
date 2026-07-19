# 工单:voc.ai 广告转化链路修复(P0)

**背景**:Google Ads VOC campaigns(CID 275-229-9046)已投 5 天 $178,点击 42 次,转化列全 0。
排查确认 0 注册是**测量断链**,不是(不一定是)业务事实。三处断点如下,修复后广告才能进入智能出价阶段。
**提出**:Hunter / 广告投放侧,2026-07-19。技术对接:回此文档或 11agents 平台 voc 项目。

---

## 断点 1:站上没有 Google Ads 转化标签(P0)

现状:voc.ai 装有 GTM 容器 `GTM-MD42STD`,但容器内没有 Google Ads 转化标签(页面源码无 AW- 前缀 tag)。

**要做**(GTM 内配置,不改代码):
1. 新建 Google Ads Conversion Tracking 标签,Conversion ID 用本账户现有的 `AW-10867983435`(或在 Google Ads → Tools → Conversions 为 voc.ai 新建"voc.ai signup (web)"动作拿新 label,推荐后者,和 flatkey 的动作分开)。
2. 触发条件:注册成功事件(见断点 3 的注册完成页/事件)。
3. 同容器加 **Conversion Linker** 标签(All Pages)——保存 gclid 到 first-party cookie。

## 断点 2:voc.ai → app.voc.ai 跨域丢 gclid(P0)

现状:广告落 `www.voc.ai`,注册发生在 `app.voc.ai`,两个域。GTM 未配置跨域 linker,gclid/UTM 在跳转时丢失 → 即使 app 侧记了注册,也无法归因回广告。

**要做**:
1. GTM Conversion Linker 开启 cross-domain:linker domains 加 `voc.ai, app.voc.ai`。
2. GA4 配置(若用 GA4 记 signup_success):Admin → Data Streams → Configure tag settings → Configure your domains,把两个域都加上。
3. 验证:从带 `?gclid=TEST123` 的 voc.ai 页点击 Get Agent,到 app.voc.ai 后 URL 或 cookie(`_gcl_aw`)里能看到 TEST123。

## 断点 3:广告流量没有注册动线(P0,转化率问题)

现状:
- 首页主 CTA "Get Agent" 链到 `https://app.voc.ai/dashboard/conversations` —— 未登录用户直接撞登录墙(深链仪表盘,不是注册页)。
- `app.voc.ai/signup` 返回 404,注册真实路径不明。

**要做**(任选其一,推荐 a):
a. 给落地流量一个显式注册 CTA:URL 带 `utm_medium=cpc` 时,"Get Agent" 指向注册页(注册优先、登录次之的 auth 页)。
b. 至少把 Get Agent 统一指向"注册或登录"页,而不是 dashboard 深链。
另:提供注册成功的确定性信号(独立 thank-you 页或 dataLayer push `signup_success`),供断点 1 的标签触发。

## 账户侧(投放这边处理,列出供知悉)

- 现有转化动作 `7527391177 注册(GA 事件 signup_success)` 需确认挂的是哪个 GA 属性;若是 voc.ai 的 GA4,修完断点 2 后把它(或新建的 voc.ai signup)设为 VOC campaigns 主要转化。
- 转化跑通且累计 ≥30 后,campaigns 从 Maximize Clicks 切 tCPA。

## 验收标准

1. Tag Assistant 在 voc.ai 上能看到 Conversion Linker + Ads 标签就绪;
2. 测试注册全流程后,Network 里出现 `googleadservices.com/pagead/conversion/...` 请求;
3. 48-72h 后 Google Ads → Conversions 里 voc.ai signup 状态变为 "Recording conversions";
4. VOC campaigns 的转化列开始非零(以真实 gclid 点击测试,报表延迟 3-24h)。

## 参考:flatkey 同款链路的踩坑记录

- SIGNUP 类目转化默认 biddable=False,不计入"转化"列——建好动作后要把 customer_conversion_goal 设 biddable(投放侧处理)。
- 转化标签可能打进懒加载 async chunk,验证要查产物文件而不是首页 HTML。
- 测试用假 gclid 不计入 campaign 报表,只验证埋点 fire。
