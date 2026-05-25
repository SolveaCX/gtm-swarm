# GTM Agent Roster

> **Auto-generated from `server/agent-registry.js`.** Do NOT hand-edit this file.
> Regenerate via `node scripts/sync-roster.js`. CI guards drift via `--check`.

**Total: 13 agents** · Categories: 🟪 Foundation · 🟩 Content · 🟦 Distribution · 🟧 Revenue·Leads

| # | Agent | Platforms | Reviewer | Builder | Goal Template | Reuse | Status |
|---|---|---|---|---|---|---|---|
| 01 | 🟪 **GTM Foundation** | internal-dashboard | boyuan | zhongshilong | All agents connected. Execution monitoring, version mgmt, cost mgmt for $product. | `~/agent-teams` | ✅ deployable |
| 02 | 🟦 **KOL / KOC** | youtube · tiktok · instagram | ivy | zhangjilin | KOC outreach + auto-publishing for $product. Brand voice owned by Reviewer. | `~/MKT/TiktokAutoUploader` | ✅ deployable |
| 03 | 🟩 **Blog** | website | pengjing | zhangjilin | SEO blogs across $product lines. Monthly topic map. | `~/solvea-content-engine` | ✅ deployable |
| 04 | 🟩 **Backlink** | external-sites | pengjing | **TBD** | Quality backlinks + domain authority for $product. | greenfield | 🚫 blocked (no triangle) |
| 05 | 🟩 **Video** | youtube · tiktok | zhuangkexin | zhangjilin | Auto-generated videos for $product. Reviewer owns likes/views target. | `~/MKT` | ✅ deployable |
| 06 | 🟦 **Reddit** | reddit | ivy-chen | wayne | Auto-publish at scale for $product. Drive inbound traffic. | greenfield | ✅ deployable |
| 07 | 🟦 **Social Media** | x · github · linkedin | ivy-chen | wayne | Cross-platform native publishing for $product. Reviewer owns brand voice. | `~/solvea-content-engine` | ✅ deployable |
| 08 | 🟧 **Ads** | google-ads · ios-asa · android-ads | **TBD** | gaoboyuan | Paid acquisition for $product. Optimize CAC/conversion. | `~/google-ads` | 🚫 blocked (no triangle) |
| 09 | 🟧 **EDM** | email | **TBD** | **TBD** | Email pipeline + owned audience for $product. | `~/google-ads/dropin` | 🚫 blocked (no triangle) |
| 10 | 🟧 **Yelp** | yelp | **TBD** | **TBD** | Auto-find leads from reviews/complaints for $product. | greenfield | 🚫 blocked (no triangle) |
| 11 | 🟦 **Poster (WeChat)** | wechat | **TBD** | **TBD** | WeChat 公众号 auto-publish for $product. | greenfield | 🚫 blocked (no triangle) |
| 12 | 🟦 **MCP Registry** | mcp.so · smithery · pulsemcp · awesome-mcp-servers | **TBD** | **TBD** | Publish $product as an agent-callable MCP tool. Maintain catalog presence + version bumps. | `~/MKT/solvea-mcp` | 🚫 blocked (no triangle) |
| 13 | 🟧 **Customer Agent** | website-chat · in-app-chat · email · support-desk | boyuan | **TBD** | Convert pre-sales users for $product and resolve post-sales customer requests with measurable retention impact. | `Solvea customer service agent` | 🚫 blocked (no triangle) |

## Deployment status

- ✅ Deployable (Iron Triangle complete): **6**
- 🚫 TBD-blocked (missing Builder or Reviewer): **7**

### TBD slots — forcing function for hiring

Per Principle 3 (No Triangle = No Agent), blocked agents stay non-deployed until people are named:

- **04 Backlink** needs **Builder**
- **08 Ads** needs **Reviewer**
- **09 EDM** needs **Builder** + **Reviewer**
- **10 Yelp** needs **Builder** + **Reviewer**
- **11 Poster (WeChat)** needs **Builder** + **Reviewer**
- **12 MCP Registry** needs **Builder** + **Reviewer**
- **13 Customer Agent** needs **Builder**

## Adding a new agent

1. Append entry to `server/agent-registry.js` (set `ordering` to next available number)
2. Run `node scripts/sync-roster.js` to regenerate this file
3. Commit both files together
4. Step 4 ContentOS prompt picks up the new agent on next run — no prompt edit needed
