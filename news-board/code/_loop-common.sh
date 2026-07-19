# 知识库 loop 公共片段：失败桌面通知 + iCloud 物化
# 由各 daily-*.sh 在 export 之后 source。

LOOPNAME="$(basename "$0" .sh)"

# 任何非零退出 → 弹 macOS 桌面通知（launchd 用户会话下可见；cron 下不可见）
trap 'rc=$?; if [ "$rc" -ne 0 ]; then osascript -e "display notification \"$LOOPNAME 挂了(退出码$rc)，看 ~/Library/Logs/$LOOPNAME\" with title \"📚 知识库 loop 出错\" sound name \"Basso\"" >/dev/null 2>&1; fi' EXIT

# 强制把 iCloud 占位文件(.icloud / 已卸载)拉回本地，避免无人值守时读到空 → 误判 0 素材
materialize(){
  [ -e "$1" ] || return 0
  /usr/bin/brctl download "$1" >/dev/null 2>&1
}

# 调 claude -p，失败（含 API 503/超时等瞬时故障）自动等 30 分钟重试 1 次。
# "未登录/无效key" 是永久性故障，不重试直接返回。
# 用法: OUT=$(run_claude_retry "$PROMPT_TEXT" 2400); RC=$?
run_claude_retry(){
  local prompt="$1" tmo="${2:-2400}" attempt out rc
  for attempt in 1 2; do
    out=$(timeout "$tmo" claude -p "$prompt" --dangerously-skip-permissions 2>&1)
    rc=$?
    echo "$out"
    if echo "$out" | grep -qiE "not logged in|please run /login|invalid api key|invalid authentication|authentication credentials|401|oauth|token.*expired|expired.*token"; then
      return 86
    fi
    if [ "$rc" -eq 0 ]; then
      return 0
    fi
    if [ "$attempt" -eq 1 ]; then
      log "⚠️ claude 退出码=$rc（疑似瞬时故障，如 API 503），30 分钟后自动重试 1 次"
      sleep 1800
    fi
  done
  return "$rc"
}
