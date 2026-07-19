#!/bin/bash
# 看板小循环(每小时跑):检测 AI日报/选题雷达 库里有没有新文件 → 重建看板 + 重传 OSS。
# 轻量,不调 Claude,不弹通知。launchd com.477.dashboard-refresh

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
VAULT="/Users/siqiteng/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian/477知识中心"
SITE="$VAULT/01_Projects/AI自媒体/选题雷达/site"
LOGDIR="$HOME/Library/Logs/dashboard-refresh"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/$(date +%F).log"
STAMP="$LOGDIR/.last_seen"

log(){ echo "$(date '+%F %T') $*" >>"$LOG"; }

# 找当前最新的日报文件时间戳(AI日报 + 全球新闻 + AI博客)
LATEST=$(find \
  "$VAULT/04_Archive" \
  "$VAULT/00_Inbox" \
  "$VAULT/01_Projects/AI自媒体/选题雷达" \
  -type f \( -name '*_AI早报.md' -o -name '*_AI快讯.md' -o -name '*_AI精读.md' \
            -o -name '*_全球新闻选题日报.md' -o -name '*_AI博客日报.md' \) \
  -newer /tmp 2>/dev/null -printf '%T@\n' 2>/dev/null | sort -rn | head -1)
# macOS find 不支持 -printf, 改 stat
LATEST=$(find \
  "$VAULT/04_Archive" \
  "$VAULT/00_Inbox" \
  "$VAULT/01_Projects/AI自媒体/选题雷达" \
  -type f \( -name '*_AI早报.md' -o -name '*_AI快讯.md' -o -name '*_AI精读.md' \
            -o -name '*_全球新闻选题日报.md' -o -name '*_AI博客日报.md' \) 2>/dev/null \
  -exec /usr/bin/stat -f '%m' {} \; | sort -rn | head -1)

LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ "${LATEST:-0}" -le "${LAST:-0}" ]; then
  log "无新内容(latest=$LATEST last=$LAST),跳过"; exit 0
fi

log "发现新内容(latest=$LATEST > last=$LAST),重建+上传"
if /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 "$HOME/.477-automation/build-dashboard.py" >>"$LOG" 2>&1; then
  log "✅ 看板已重建"
  if ~/bin/ossutil cp "$SITE/" oss://skill101-news/ -r -f --region cn-hangzhou >>"$LOG" 2>&1; then
    log "✅ 已部署 news.skill101.cn"
    echo "$LATEST" > "$STAMP"
  else
    log "⚠️ OSS 上传失败"
  fi
else
  log "⚠️ 看板重建失败"
fi
exit 0
