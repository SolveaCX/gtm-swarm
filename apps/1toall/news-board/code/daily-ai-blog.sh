#!/bin/bash
# AI 博客日报（每早 10:05；launchd com.477.loop-ai-blog）
# 用 ai-builders-digest skill 中心化抓 builder 的 X/播客/博客 → 出日报 → 重建看板。

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
source "$HOME/.477-automation/_loop-common.sh"
VAULT="/Users/siqiteng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/477知识中心"
PROMPT="$HOME/.477-automation/prompts/ai-blog-prompt.md"
LOGDIR="$HOME/Library/Logs/daily-ai-blog"; mkdir -p "$LOGDIR"
T="$(date +%F)"; LOG="$LOGDIR/$T.log"
REPORT="$VAULT/01_Projects/AI自媒体/选题雷达/${T}_AI博客日报.md"

log(){ echo "$(date '+%F %T') $*" >>"$LOG"; }

log "==== 启动（$T AI博客日报）===="
cd "$VAULT" || { log "❌ 无法进入库目录（FDA?）"; exit 1; }

STAMP="$LOGDIR/.last_run_stamp"; : > "$STAMP"
P="$(cat "$PROMPT" 2>/dev/null)"
[ -z "$P" ] && { log "prompt empty/unreadable (iCloud evict?): $PROMPT"; exit 88; }
log "调用 flatkey gpt-5.5 引擎(Firecrawl搜真新闻+写)…"
python3 "$HOME/.477-automation/flatkey-agent.py" \
  --out "$REPORT" \
  --writer "$HOME/.477-automation/writers/blog-writer.md" \
  --queries "AI builder Anthropic OpenAI news 2026" "AI developer tools launch 2026" "AI research announcement 2026" \
  --recency-days 3 --scrape 4 --max-steps 16 >>"$LOG" 2>&1
RC=$?
log "flatkey 引擎退出码=$RC"

if [ "$RC" -eq 86 ]; then
  log "❌ claude 未登录（headless 无认证）"; exit 86
fi
if [ "$RC" -ne 0 ] || [ ! "$REPORT" -nt "$STAMP" ]; then
  log "⚠️ claude 退出码=$RC 或日报非本次新生成（疑似未生效/出错，重试后仍失败），见上方输出"; exit 87
fi
log "✅ 完成：AI博客日报 → $REPORT"

# 重建日历看板（含今天的新闻+AI日报+AI博客）
if /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 "$HOME/.477-automation/build-dashboard.py" >>"$LOG" 2>&1; then
  log "✅ 看板已重建"
  # 部署：上传到 OSS → news.skill101.cn
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
