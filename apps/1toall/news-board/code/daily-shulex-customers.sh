#!/bin/bash
# Shulex 客户新闻（每天 11:25 + 22:25；launchd com.477.loop-shulex-customers；扫已成交客户名单近况）
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
source "$HOME/.477-automation/_loop-common.sh"
VAULT="/Users/siqiteng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/477知识中心"
PROMPT="$HOME/.477-automation/prompts/shulex-customers-prompt.md"
LOGDIR="$HOME/Library/Logs/daily-shulex-customers"; mkdir -p "$LOGDIR"
T="$(date +%F)"; LOG="$LOGDIR/$T.log"
REPORT="$VAULT/01_Projects/AI自媒体/选题雷达/${T}_Shulex客户新闻.md"

log(){ echo "$(date '+%F %T') $*" >>"$LOG"; }

log "==== 启动（$T Shulex客户新闻）===="
cd "$VAULT" || { log "❌ 无法进入库目录（FDA?）"; exit 1; }

STAMP="$LOGDIR/.last_run_stamp"; : > "$STAMP"
P="$(cat "$PROMPT" 2>/dev/null)"
[ -z "$P" ] && { log "prompt empty/unreadable (iCloud evict?): $PROMPT"; exit 88; }
log "调用 flatkey gpt-5.5 引擎(Firecrawl搜真新闻+写)…"
python3 "$HOME/.477-automation/flatkey-agent.py" \
  --out "$REPORT" \
  --writer "$HOME/.477-automation/writers/kehu-writer.md" \
  --queries "跨境电商 大卖 融资 IPO 新品 2026" "Anker UGREEN Baseus Dreame Roborock news 2026" "Chinese cross-border DTC brand IPO 2026" "消费电子 品牌 出海 召回 2026" \
  --recency-days 7 --scrape 4 --max-steps 18 >>"$LOG" 2>&1
RC=$?
log "flatkey 引擎退出码=$RC"

if [ "$RC" -eq 86 ]; then
  log "❌ claude 未登录（headless 无认证）"; exit 86
fi
if [ "$RC" -ne 0 ] || [ ! "$REPORT" -nt "$STAMP" ]; then
  log "⚠️ claude 退出码=$RC 或文件非本次新生成，见上方输出"; exit 87
fi
log "✅ 完成：Shulex客户新闻 → $REPORT"

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
