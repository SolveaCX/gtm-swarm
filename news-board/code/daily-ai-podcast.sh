#!/bin/bash
# AI播客（每早 10:12；launchd com.477.loop-ai-podcast；自产,不依赖外部系统）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
source "$HOME/.477-automation/_loop-common.sh"
VAULT="/Users/siqiteng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/477知识中心"
PROMPT="$HOME/.477-automation/prompts/ai-podcast-prompt.md"
LOGDIR="$HOME/Library/Logs/daily-ai-podcast"; mkdir -p "$LOGDIR"
T="$(date +%F)"; LOG="$LOGDIR/$T.log"
REPORT="$VAULT/00_Inbox/${T}_AI播客.md"

log(){ echo "$(date '+%F %T') $*" >>"$LOG"; }

log "==== 启动（$T AI播客）===="
cd "$VAULT" || { log "❌ 无法进入库目录（FDA?）"; exit 1; }

STAMP="$LOGDIR/.last_run_stamp"; : > "$STAMP"
P="$(cat "$PROMPT" 2>/dev/null)"
[ -z "$P" ] && { log "prompt empty/unreadable (iCloud evict?): $PROMPT"; exit 88; }
log "调用 flatkey gpt-5.5 引擎(Firecrawl搜真新闻+写)…"
python3 "$HOME/.477-automation/flatkey-agent.py" \
  --out "$REPORT" \
  --writer "$HOME/.477-automation/writers/podcast-writer.md" \
  --queries "AI podcast Latent Space No Priors 2026" "AI founder interview podcast 2026" "AI 播客 访谈 2026" \
  --recency-days 7 --scrape 2 --max-steps 12 >>"$LOG" 2>&1
RC=$?
log "flatkey 引擎退出码=$RC"

if [ "$RC" -eq 86 ]; then
  log "❌ claude 未登录（headless 无认证）"; exit 86
fi
if [ "$RC" -ne 0 ] || [ ! "$REPORT" -nt "$STAMP" ]; then
  log "⚠️ claude 退出码=$RC 或文件非本次新生成，见上方输出"; exit 87
fi
log "✅ 完成：AI播客 → $REPORT"

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
