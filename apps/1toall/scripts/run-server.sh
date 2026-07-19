#!/bin/bash
# LaunchAgent 调用：前台跑 node（launchd 负责监控 + 崩溃自动重启）。
cd "$(dirname "$0")/.." || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# 从钥匙串取 flatkey（首次可能弹一次「始终允许」）
export FLATKEY_API_KEY="$(security find-generic-password -s FLATKEY_API_KEY -w 2>/dev/null)"
exec node server.js
