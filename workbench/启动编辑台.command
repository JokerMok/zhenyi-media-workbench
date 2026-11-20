#!/bin/zsh
set -e
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS:$PATH"
node ./本机服务.mjs --open
