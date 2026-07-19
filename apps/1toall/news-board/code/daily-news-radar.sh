#!/bin/bash
# 全球新闻 → 选题雷达（每早 10:00 跑；launchd com.477.loop-news-radar）
# 抓一手全球新闻 → 写日报 → 结合 Shulex + 偷懒记 给选题推荐。

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
source "$HOME/.477-automation/_loop-common.sh"
export FLATKEY_API_KEY="$(security find-generic-password -s FLATKEY_API_KEY -w 2>/dev/null)"
VAULT="/Users/siqiteng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/477知识中心"
PROMPT="$HOME/.477-automation/prompts/news-radar-prompt.md"
LOGDIR="$HOME/Library/Logs/daily-news-radar"; mkdir -p "$LOGDIR"
T="$(date +%F)"; LOG="$LOGDIR/$T.log"
REPORT="$VAULT/01_Projects/AI自媒体/选题雷达/${T}_全球新闻选题日报.md"

log(){ echo "$(date '+%F %T') $*" >>"$LOG"; }

log "==== 启动（$T 全球新闻选题日报）===="
cd "$VAULT" || { log "❌ 无法进入库目录（FDA?）"; exit 1; }
mkdir -p "$VAULT/01_Projects/AI自媒体/选题雷达"

STAMP="$LOGDIR/.last_run_stamp"; : > "$STAMP"
P="$(cat "$PROMPT" 2>/dev/null)"
[ -z "$P" ] && { log "prompt empty/unreadable (iCloud evict?): $PROMPT"; exit 88; }
log "调用 flatkey gpt-5.5 引擎(Firecrawl搜真新闻+写)…"
python3 "$HOME/.477-automation/flatkey-agent.py" \
  --out "$REPORT" \
  --writer "$HOME/.477-automation/writers/newsradar-writer.md" \
  --queries "跨境电商 关税 平台规则 亚马逊 TikTok 2026" "消费电子 新品发布 出海 2026" "AI 大模型 发布 融资 2026" "AI 客服 电商 SaaS 2026" \
  --recency-days 5 --scrape 5 --max-steps 18 >>"$LOG" 2>&1
RC=$?
log "flatkey 引擎退出码=$RC"

if [ "$RC" -eq 86 ]; then
  log "❌ claude 未登录（headless 无认证）"; exit 86
fi
if [ "$RC" -ne 0 ] || [ ! "$REPORT" -nt "$STAMP" ]; then
  log "⚠️ claude 退出码=$RC 或日报非本次新生成（疑似未生效/出错，重试后仍失败），见上方输出"; exit 87
fi
log "✅ 完成：全球新闻选题日报 → $REPORT"

# 渲染 477汇报风格 HTML 页（每天自动套同一模板）
HTML="${REPORT%.md}.html"
if python3 "$HOME/.477-automation/render-news-page.py" "$REPORT" "$HTML" >>"$LOG" 2>&1; then
  git add "$HTML" && git commit -q -m "auto: $T 新闻日报HTML页（477汇报风格）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" && log "✅ HTML 页 → $HTML"
else
  log "⚠️ HTML 渲染失败（不影响 md 日报），见上方输出"
fi

# 重建看板 + 部署（跟其余5个内容loop保持一致，各自独立部署一次）
if /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 "$HOME/.477-automation/build-dashboard.py" >>"$LOG" 2>&1; then
  log "✅ 看板已重建"
  if ~/bin/ossutil cp "$VAULT/01_Projects/AI自媒体/选题雷达/site/" oss://skill101-news/ -r -f --region cn-hangzhou >>"$LOG" 2>&1; then
    log "✅ 已部署 news.skill101.cn"
  else
    log "⚠️ OSS 上传失败（看板已本地更新），见上方输出"
  fi
else
  log "⚠️ 看板重建失败（不影响日报），见上方输出"
fi
log "==== 结束 ===="
exit 0
