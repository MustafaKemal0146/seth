#!/bin/bash
set -e
echo "🚀 SETH CLI Kurulumu Başlatılıyor..."

if ! command -v node &> /dev/null; then
    echo "❌ Node.js kurulu değil. v18+ kurun: https://nodejs.org"
    exit 1
fi
NODE_VER=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
echo "✅ Node.js v$NODE_VER algılandı."

TMP_DIR="/tmp/seth_install_$$"
rm -rf "$TMP_DIR" && mkdir -p "$TMP_DIR" && cd "$TMP_DIR"

echo "📦 Paket indiriliyor..."
curl -L -o seth_bundle.zip https://seth.mustafakemalcingil.site/seth-web-son.zip
unzip -q seth_bundle.zip
cd seth-web-son/cli

# package.json bin yolunu düzelt
if [ -f "cli.js" ] && [ ! -f "dist/cli.js" ]; then
    sed -i 's|"main": "dist/cli.js"|"main": "cli.js"|g' package.json
    sed -i 's|"seth": "dist/cli.js"|"seth": "cli.js"|g' package.json
fi
chmod +x cli.js 2>/dev/null || true

echo "📦 Bağımlılıklar kuruluyor..."
npm install --omit=dev

echo "⚙️ Sisteme ekleniyor..."
npm install -g .

# PATH fix
NPM_BIN=$(npm prefix -g)/bin
export PATH="$NPM_BIN:$PATH"

# .bash_profile yoksa oluştur ve .bashrc'yi çağırsın
if [ ! -f "$HOME/.bash_profile" ]; then
    echo '[ -f ~/.bashrc ] && source ~/.bashrc' > "$HOME/.bash_profile"
fi

for RC in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" "$HOME/.bash_profile"; do
    if [ -f "$RC" ] && ! grep -q "$NPM_BIN" "$RC" 2>/dev/null; then
        echo "export PATH=\"$NPM_BIN:\$PATH\"" >> "$RC"
    fi
done

# Mevcut oturuma da uygula
source "$HOME/.bashrc" 2>/dev/null || true

echo "----------------------------------------------------"
echo "✅ SETH KURULDU!"
echo "   Yeni terminal aç ve 'seth' yaz."
echo "   Çalışmazsa: export PATH=\"$NPM_BIN:\$PATH\""
echo "----------------------------------------------------"
