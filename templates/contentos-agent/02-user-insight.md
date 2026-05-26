# ContentOS Agent — Step 2: User Insight (CIA methodology)

Continuing from Step 1 (Market Insight). This step adopts CIA's user-signal extraction approach (App reviews + Reddit + TikTok hook patterns + buying trigger taxonomy).

## Core Discipline

> **Users don't tell you what they want — they tell you what they hate.** Build the ICP from negative-review patterns, Reddit complaint threads, TikTok pain-validation videos. Then triangulate triggers from sales-call objections and pricing-page friction.

## Input

1. `project.yaml`
2. `01-market-insight.md` (Step 1 output, possibly Founder-edited)

## Data Source Priority

**If `## 🕵️ CIA REAL DATA` is in the prompt above**: that's real App reviews / Reddit threads / TikTok high-share videos / YouTube search results from the CIA pipeline. **Cite痛点 distribution, community vocab, and hook patterns directly from CIA — these are sample-sized, ranked, and timestamped.**

**If no CIA section**: mark sections `[需 CIA Step 7/9 真实数据]` and reason from LLM context. Founder can run `scripts/cia-for-project.sh <slug> "<topic>"` to enrich.

## Output Structure

```markdown
# User Insight — <Product Name>

## 一、ICP（Ideal Customer Profile, 三层）

### 1.1 主受众（primary, 70% 内容资源）
- **Firmographic**: role + company size + revenue range + tech stack + geo
- **Psychographic**: belief / fear / aspiration
- **Trigger event**: 1 sentence — the specific moment they actively look

### 1.2 次受众（secondary, 25% 内容资源）
[same shape]

### 1.3 排除受众（explicitly NOT for, 5%）
Who would the product NOT serve? Surface this — it sharpens positioning.

## 二、Top 5 痛点（ranked by economic cost）

| # | 痛点 | 现状 cope 方式 | 年成本 / 时间 / 风险 | 数据出处 |
|---|---|---|---|---|

数据出处 marker:
- `[CIA App Reviews]` if real review data available
- `[CIA Reddit]` if real Reddit thread available
- `[LLM derived]` if speculative from positioning

## 三、Buying Triggers（3-5 个 EVENTS）

> Events, not states. "Wants more revenue" is a state. "Just hit $500K MRR and CEO wants Sundays back" is an event.

| Trigger event | Predicted prevalence | What they Google/ask after |
|---|---|---|

## 四、Top 3 Objections + 最强 Counter

| Objection | Counter (1 sentence, evidence-backed) |
|---|---|

## 五、Vocabulary Audit

> Critical for content engine voice tuning. The registered GTM agents will only sound native if we capture vocabulary correctly.

### 5.1 词汇他们用（自描述 + 行业黑话）
- Tier 1 (always): ...
- Tier 2 (often): ...

### 5.2 词汇他们不用（销售感 / 学术 / 平台感 — 避雷）
- ...

### 5.3 触发情绪词（pain + relief language pairs）
| Pain phrase | Relief phrase |
|---|---|

## 六、Channel × Trigger 映射

For each trigger, where do they self-diagnose / discover solutions?

| Trigger | First search platform | Discovery channels | Decision channels |
|---|---|---|---|

This feeds Step 4 (Content Strategy) — tells us which registered GTM agents to activate hardest.

## 七、Top 3 用户访谈问题（for Founder to actually run）

3 questions the Founder should ask 5 real customers this week to validate / invalidate the ICP above.

## 八、对 Step 1 假设的回看

| Step 1 假设 | Step 2 用户层面证据 | 是否需要调整 Step 1 |
|---|---|---|

If user-layer evidence contradicts market-layer hypothesis, surface it.

## 九、Data Gaps

Concrete CIA pipeline runs that would materially improve this brief:
1. **App Reviews** for [top 3 competitors with app_id list]
2. **Reddit scrape** for [r/<name> × N query strings]
3. **TikTok hook patterns** for [N candidate query strings]

## 十、Key Assumptions

5 explicit invalidation conditions for this user model.
```

## Critical Rules

1. **ICP must be cold-email-actionable**. "Founders" isn't ICP. "Medspa owners running 2-5 locations on GoHighLevel who route after-hours calls to a $500/mo human answering service" IS ICP.
2. **痛点 ranked by ECONOMIC cost** (time × hourly rate, revenue lost, risk exposure), not by emotional intensity.
3. **Buying triggers are EVENTS** with predictable Google searches following.
4. **Vocabulary audit is read by run-agent.py** — be precise, this affects every Reddit / X / LinkedIn post we generate.
5. **批判 Step 1 mandatory** — if user-side evidence weakens market-side assumptions, surface it.

This brief becomes input for Step 3 (Competitor Analysis).

---

## OUTPUT INSTRUCTION

**Language requirement:** 用中文输出整份用户洞察 brief。产品名、竞品名、URL、英文关键词、代码字段可以保留原文；解释、判断、建议、表格说明必须使用中文。

You ARE writing the markdown brief as your direct response. Do NOT summarize, do NOT say "I wrote ..." — output the structured brief itself with all 十 sections. Target 2500-5000 words. Start with `# User Insight — <Product Name>`. No preamble.
