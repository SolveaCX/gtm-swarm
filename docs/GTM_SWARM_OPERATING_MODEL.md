# GTM Swarm x Multica 运营模型

本文档用于给团队解释 GTM Swarm 如何和 Multica 协作，以及哪些东西必须标准化。

一句话定义：

> Multica 管任务、执行、审批和审计；GTM Swarm 管产品知识、Agent 模板、数据和持续学习。

详细设计见：`docs/superpowers/specs/2026-05-26-gtm-swarm-multica-operating-model-design.md`

---

## 1. 系统边界

### Multica 是运营控制台

Multica 负责管理每天发生的工作：

- Agent 实例。
- Runtime 绑定。
- Issue / task queue。
- Assignee、status、priority。
- 评论、审核、审批。
- Agent 执行记录。
- SOP 修改提案的流转和审计。

原则：只要一个决定会产生任务，或改变未来 Agent 的行为，就应该在 Multica 里留下 issue/comment 记录。

### GTM Swarm 是知识和数据层

GTM Swarm 负责沉淀和调用知识：

- 全局 GTM Agent skill 模板。
- 每个产品 project 的 SOP / memory。
- 产品配置、定位、ICP、竞品信息。
- Dashboard metrics / telemetry。
- AI review digest。
- 已审批的 SOP / memory 更新。
- 和 Multica 的数据同步、任务创建、结果读取。

原则：GTM Swarm 不再重复建设一套任务系统，任务和审批都走 Multica。

---

## 2. 核心概念

### Project

一个产品就是一个 project，例如：

- `voc-ai`
- `solvea`
- `flatkey`

每个 project 有自己的：

- 产品定位。
- ICP。
- 竞品。
- 渠道经验。
- winning hooks。
- 用户 objections。
- project-level SOP。
- dashboard 数据。

### Global Agent Skill Template

全局 Agent skill 模板定义通用方法论。

例如：

- Reddit Agent。
- X Agent。
- Blog/SEO Agent。
- Research/VOC Agent。
- Landing/CRO Agent。
- AI Strategy Reviewer Agent。

它回答的是：这个类型的 Agent 一般应该怎么工作。

### Project SOP / Memory

Project SOP / Memory 是某个产品自己的上下文。

它回答的是：这个产品在这个渠道上应该怎么做。

默认执行模型：

```text
Agent 行为 =
  Global Agent Skill Template
  + Project SOP
  + Project Memory
  + 当前 Multica Issue 上下文
```

所以 Project SOP 本质上也是 Agent SOP 的一部分，但它不是 fork 一份完整 skill，而是对全局模板的产品级补充和覆盖。

### Runtime-backed Multica Agent

概念关系：

```text
runtime = 执行能力
Multica agent = workspace 里的具体执行身份
GTM Swarm = 给 agent 提供知识、数据和上下文
```

GTM 工作里的 Agent 应该存在 Multica 里。GTM Swarm 只保存必要引用和上下文，不复制一套 Agent 主数据。

---

## 3. Reviewer 模型

GTM Swarm 同时使用人类 reviewer 和 AI reviewer。

### Human Reviewer

人类 reviewer 负责判断：

- 哪些 insight 真的重要。
- 哪些数据只是短期噪音。
- 哪些 SOP 改动值得进入系统。
- 哪些任务优先级更高。
- 哪些内容会伤害品牌、定位或信任。
- 哪些 project 经验可以升级成 global skill template。

### AI Strategy Reviewer

AI reviewer 负责补足注意力：

- 每天读 dashboard。
- 读 Agent 输出。
- 读 Multica issue/comment。
- 读 review 结果。
- 读 telemetry 和 artifact。
- 总结异常、机会、重复问题和候选改进。

AI reviewer 可以高频提出 proposal，但不直接修改 global skill template。

---

## 4. 四类标准 Issue

所有 GTM 工作和系统学习，都应该归到下面四类之一。

### 1. Execution Task

让某个 Agent 执行一个明确任务。

例子：

- 写一篇 Reddit post。
- 把高互动 X thread 扩展成 blog。
- 生成 landing page copy。
- 调研竞品评论。

低风险 execution task 可以自动创建和执行。

### 2. Experiment Task

测试一个假设，并要求回收数据。

必须写清楚：

- hypothesis。
- 参与 agent / channel。
- variants。
- success metric。
- measurement window。
- 后续动作。

实验通常建议 human approve 后再执行。

### 3. Memory Update

更新某个 project 的知识，不改变通用 SOP。

例子：

- 新增一个用户 objection。
- 记录某个产品的 winning hook。
- 加入一条竞品 claim。
- 保存一条客户原话。

默认建议 human approve，尤其是会影响 messaging 或 positioning 的内容。

### 4. SOP Change

修改 project SOP 或 global agent skill template。

例子：

- 修改某个 project 的 Reddit 开头规则。
- 给 Blog Agent 增加 checklist。
- 把一个 project learning 提升到全局 X Agent 模板。
- 修改 AI reviewer rubric。

SOP Change 必须 human approve。Global skill template 不能自动改。

---

## 5. Proposal 标准格式

AI 和人类提出的 proposal，都应该尽量使用同一套字段。

```yaml
type: sop_change # execution_task | experiment_task | memory_update | sop_change
project: voc-ai
target_scope: project # project | global
target_agent_type: reddit
target_file: projects/voc-ai/sop/reddit.md
title: "Reddit 优先使用 pain-first hook"
summary: "过去 3 天 pain-first posts 的评论深度更高。"
evidence:
  - kind: metric
    reference: "comment depth +42%"
  - kind: artifact
    reference: "multica://issue/<id>"
  - kind: reviewer_note
    reference: "Human reviewer confirmed"
risk: medium # low | medium | high
confidence: medium # low | medium | high
requires_human_approval: true
expected_effect: "提高 Reddit native fit 和回复率。"
rollback_plan: "如果后续 5 条表现下降，移除此 project SOP override。"
```

关键不是字段越多越好，而是每个 proposal 都必须说明：

- 改什么。
- 为什么改。
- 证据是什么。
- 风险多大。
- 谁审批。
- 怎么回滚。

---

## 6. 权限规则

| 变更对象 | AI 可提出 | AI 可自动落地 | 默认审批 |
|---|---:|---:|---|
| Execution task | 可以 | 低风险可以 | 可选 human review |
| Experiment task | 可以 | 通常不可以 | 建议 human approve |
| Project memory | 可以 | 可配置 | 默认 human approve |
| Project SOP | 可以 | 不可以 | 必须 human approve |
| Global skill template | 可以 | 不可以 | 必须 human approve |

原因：任务执行通常可回滚，但 SOP / skill 改动会影响未来所有执行，所以必须更谨慎。

---

## 7. 每日学习闭环

标准每日节奏：

```text
1. Agents 执行 Multica tasks。
2. GTM Swarm 收集 artifacts 和 metrics。
3. Dashboard 展示表现。
4. AI Strategy Reviewer 生成 daily review digest。
5. Human reviewer 阅读 digest 和 dashboard。
6. Reviewer approve / reject / edit proposals。
7. 通过的 proposal 变成 task / experiment / memory update / SOP change。
8. 通过的知识变更写回 GTM Swarm。
9. 后续 Agent run 加载新知识。
```

Daily review digest 应该包含：

- 哪些指标变了。
- 哪些内容表现异常好或异常差。
- 哪些 Agent 卡住或质量下降。
- 哪些 review feedback 重复出现。
- 哪些 project memory 值得新增。
- 哪些 SOP change 值得考虑。
- 下一步该执行哪些 task / experiment。

---

## 8. SOP Change 生命周期

SOP 修改必须经过审计链：

```text
signal detected
  -> proposal created in Multica
  -> human reviewer approve / reject / edit
  -> SOP maintainer agent drafts patch
  -> human final review
  -> patch lands in GTM Swarm knowledge assets
  -> Multica issue 记录最终变更
  -> future runs load updated SOP
```

任何 SOP change 都应该能回答：

- 改了什么？
- 为什么改？
- 证据是什么？
- 谁批准？
- 影响 project 还是 global template？
- 如何回滚？

---

## 9. Project Learning 升级为 Global Template 的规则

大多数学习先进入 project memory 或 project SOP。

只有满足下面条件之一，才考虑升级为 global agent skill template：

- 多个 project 都出现同样学习。
- 这个学习明显是渠道通用规律，而不是产品特例。
- 它修复了 base agent 的重复质量问题。
- Human reviewer 判断所有产品都应该继承。

这样可以避免某个产品的短期数据污染所有产品。

---

## 10. 初始 Agent 集合

建议先固定少量基础 GTM Agent：

- AI Strategy Reviewer。
- Research/VOC Agent。
- Positioning Agent。
- Reddit Agent。
- X Agent。
- Blog/SEO Agent。
- Newsletter Agent。
- Landing/CRO Agent。

新增 Agent 的标准：当某类工作重复出现，并且无法自然放进现有角色时，再新增。

---

## 11. 运营原则

1. Multica 是 control plane，GTM Swarm 是 knowledge + metrics layer。
2. 重要决定必须在 Multica 留审计记录。
3. AI 可以高频提案，但行为变更要 human approve。
4. Project learning 先本地沉淀，再考虑升级全局。
5. Execution task 可以比 SOP change 更自动化。
6. 没有 evidence 的 proposal 不能改 SOP。
7. Global skill template 要保持通用、小而清晰。
8. Project memory 要具体、最新、容易被 Agent 加载。
9. Experiment 必须先定义 success metric。
10. 系统目标不是完成当天任务，而是让未来执行越来越好。
