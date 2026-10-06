#!/usr/bin/env bash
# Optional helper: puts a simplex-chat CLI binary into docker/cli/bin/ so the
# image build uses it instead of downloading. Prefers a local copy
# (SIMPLEX_BIN or ~/.local/bin/simplex-chat, read-only), otherwise downloads
# the Ubuntu 24.04 build from GitHub releases.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p bin
VERSION="${SIMPLEX_VERSION:-7.0.2}"
LOCAL="${SIMPLEX_BIN:-$HOME/.local/bin/simplex-chat}"

if [ -f bin/simplex-chat ]; then
  echo "using cached bin/simplex-chat ($(bin/simplex-chat --version 2>/dev/null | head -1 || echo '?'))"
elif [ -x "$LOCAL" ]; then
  echo "copying $LOCAL"
  cp "$LOCAL" bin/simplex-chat
else
  URL="https://github.com/simplex-chat/simplex-chat/releases/download/v${VERSION}/simplex-chat-ubuntu-24_04-x86_64"
  echo "downloading $URL"
  curl -fL --retry 3 -o bin/simplex-chat "$URL"
fi
chmod +x bin/simplex-chat
