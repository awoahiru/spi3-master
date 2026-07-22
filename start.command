#!/bin/zsh
# SPI3 マスター 起動スクリプト（ダブルクリックで起動）
cd "$(dirname "$0")"
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
PORT=8355
echo "=============================================="
echo "  SPI3 マスター を起動します"
echo ""
echo "  Mac:     http://localhost:${PORT}"
echo "  iPhone:  http://${IP}:${PORT}"
echo "  （iPhoneは同じWi-Fiに接続してSafariで開き、"
echo "    共有ボタン→「ホーム画面に追加」でアプリ化）"
echo ""
echo "  終了するには control+C"
echo "=============================================="
open "http://localhost:${PORT}"
python3 -m http.server ${PORT}
