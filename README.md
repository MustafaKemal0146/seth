<p align="center">
  <img src="logo.jpg" alt="SETH Logo" width="540"/>
</p>

<h1 align="center">SETH</h1>

<p align="center">
  <strong>Terminalinizde çalışan Türkçe yapay zeka kodlama ajanı.</strong><br/>
  Claude, Gemini, OpenAI ve Ollama desteğiyle güçlü bir geliştirici asistanı.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-green?style=flat-square&logo=node.js"/>
  <img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript"/>
  <img src="https://img.shields.io/badge/Version-3.4.0-purple?style=flat-square"/>
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square"/>
  <img src="https://img.shields.io/badge/Dil-Türkçe-red?style=flat-square"/>
</p>

---

## 🚀 Hızlı Başlangıç

```bash
npm install -g seth
# veya
npx seth
```

```bash
# Etkileşimli REPL başlat
seth

# Belirli sağlayıcı ile başlat
seth --provider claude
seth --provider gemini
seth --provider ollama

# Tek seferlik (headless) mod
seth -p "bu projeyi özetle"
seth -p "src/index.ts dosyasındaki hataları düzelt"
```

---

## ⚙️ Yapılandırma

### Ortam Değişkenleri

```bash
export ANTHROPIC_API_KEY=sk-ant-xxxxx     # Claude için
export OPENAI_API_KEY=sk-xxxxx            # OpenAI için
export GEMINI_API_KEY=AIzaxxxxx           # Gemini için
# Ollama için API anahtarı gerekmez — ollama serve yeterli
```

### Ayar Dosyası

`~/.seth/settings.json` oluşturarak varsayılan sağlayıcı ve model ayarlayabilirsiniz:

```json
{
  "defaultProvider": "ollama",
  "defaultModel": "minimax-m2.7:cloud",
  "providers": {
    "claude": { "apiKey": "sk-ant-xxx", "model": "claude-sonnet-4-20250514" },
    "openai": { "apiKey": "sk-xxx", "model": "gpt-4o" },
    "gemini": { "apiKey": "AIza-xxx", "model": "gemini-2.5-pro" },
    "ollama": { "baseUrl": "http://localhost:11434", "model": "minimax-m2.7:cloud" }
  }
}
```

### MCP Desteği (İsteğe Bağlı)

`~/.seth/mcp.json` ile [Model Context Protocol](https://modelcontextprotocol.io) sunucuları tanımlanabilir:

```json
{
  "servers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/projeler"]
    }
  }
}
```

### Hook Sistemi (İsteğe Bağlı)

`~/.seth/hooks.json` ile araç çalışmadan önce/sonra shell komutu çalıştırabilirsiniz:

```json
[
  { "event": "PreToolUse", "tool": "file_write", "command": "echo 'Dosya yazılıyor'" },
  { "event": "PostToolUse", "tool": "shell", "command": "notify-send 'Tamamlandı'", "async": true },
  { "event": "OnResponse", "command": "notify-send 'SETH' 'Yanıt hazır'", "async": true }
]
```

---

## 🖥️ Kullanım

### Etkileşimli Mod

```bash
seth                        # Varsayılan sağlayıcı ile başlat
seth --provider claude      # Claude ile başlat
seth --provider gemini      # Gemini ile başlat
seth --model gpt-4o         # Belirli model ile başlat
```

### Headless Mod

```bash
seth -p "main.ts içindeki hatayı düzelt"
seth --auto -p "testleri çalıştır"       # Araç onaylarını atla
seth -p "projeyi özetle" --no-tools      # Araçsız çalıştır
```

### Proje Talimatları (Otomatik Yükleme)

Çalışma dizininde aşağıdaki dosyalar varsa içerikleri sistem istemine otomatik eklenir:

| Dosya | Açıklama |
|-------|----------|
| `CLAUDE.md` | Claude Code uyumu için talimatlar |
| `AGENTS.md` | AGENTS uyumu için talimatlar |
| `.seth/instructions.md` | SETH'e özel proje talimatları |

---

## 💬 SETH Komutları

### Bilgi & Analiz

| Komut | Açıklama |
|--------|-----------|
| `/yardım` | Tüm komutları listele |
| `/özellikler` | SETH yetenek raporunu göster |
| `/istatistikler` | Token kullanımı, maliyet tahmini, geçmiş sayısı |
| `/bağlam` | Token dağılımı, en çok kullanılan araçlar, tekrar okunan dosyalar |
| `/ara <kelime>` | Mevcut konuşmada arama yap |
| `/doktor` | Ortam sağlığı + araç kontrolü (curl, git, nmap, vb.) |
| `/repo_özet` | Git: dal, son commit, diff --stat, status |
| `/güncelle` | Yeni sürüm kontrolü (semver karşılaştırma) |

### Bellek & Oturum

| Komut | Açıklama |
|--------|-----------|
| `/hafıza` | Kalıcı belleği göster (`~/.seth/memory/`) |
| `/hafıza <user\|project\|feedback\|reference>` | Belirli bellek tipini göster |
| `/hafıza ekle <tip> <içerik>` | Belleğe yeni giriş ekle |
| `/hafıza sil <tip>` | Belirli bellek tipini temizle |
| `/hafıza-temizle` | Tüm kalıcı belleği sil (onay ister) |
| `/bellek` | Görev listesi + oturum özeti |
| `/context-temizle` | Oturumu sıfırla, yeni konuşma başlat |
| `/temizle` | Konuşma geçmişini temizle |
| `/sıkıştır` | Geçmişi sıkıştır |
| `/geri` | Son mesajı geri al |
| `/kaydet [dosya]` | Konuşmayı markdown olarak kaydet |
| `/geçmiş` | Önceki oturumu devam ettir |

### Ayarlar

| Komut | Açıklama |
|--------|-----------|
| `/değiştir` | Etkileşimli ayar menüsü |
| `/sağlayıcı <isim>` | Sağlayıcı değiştir: `claude`, `gemini`, `openai`, `ollama` |
| `/model <isim>` | Model adını doğrudan ayarla |
| `/modeller` | Mevcut modelleri listele ve seç |
| `/araçlar <açık\|kapalı>` | Araç kullanımını aç/kapat |
| `/ajan <açık\|kapalı>` | Çok tur ajan modunu aç/kapat |
| `/yetki <full\|normal\|dar>` | İzin seviyesini ayarla |
| `/tema` | Renk teması değiştir (dark, light, cyberpunk, retro, ocean, sunset) |
| `/apikey` | API anahtarlarını yönet / sil |
| `/context <miktar>` | Oturum token bütçesi (örn: 500k) |

### Araçlar & Sistem

| Komut | Açıklama |
|--------|-----------|
| `/hook [liste\|örnek]` | Hook sistemi yönetimi |
| `/rapor pdf` | Güvenlik taraması sonucunu LaTeX/PDF olarak dışa aktar |
| `/sor` | İstek sihirbazını başlat |
| `/dusunme` | Düşünme göstergesini aç/kapat |
| `/cd <dizin>` | Çalışma dizinini değiştir |
| `/pwd` | Mevcut dizini göster |
| `/cikis` | Uygulamadan çık |

### ⌨️ Kısayollar

| Kısayol | Açıklama |
|---------|----------|
| `Ctrl+C` | Mevcut işlemi iptal et |
| `Ctrl+D` | Boş satırda çıkış |
| `Ctrl+R` | Geçmiş fuzzy arama |
| `Esc` | AI yanıtını durdur |
| Satır sonu `\` | Çok satırlı girdi |

---

## 🛠️ Yerleşik Araçlar

### Dosya & Dizin

| Araç | Açıklama |
|------|-----------|
| `file_read` | Dosya oku (satır numarasıyla) |
| `file_write` | Dosya yaz |
| `file_edit` | Dosya düzenle (tam metin eşleşmesi) |
| `list_directory` | Dizin içeriğini listele |
| `glob` | Dosya deseni ile eşleştir |
| `batch_read` | Birden fazla dosyayı aynı anda oku |

### Arama

| Araç | Açıklama |
|------|-----------|
| `search` | Kod tabanında metin ara (ripgrep varsa kullanır) |
| `grep` | Regex ile dosyalarda ara (ripgrep varsa kullanır) |

### Web

| Araç | Açıklama |
|------|-----------|
| `web_fetch` | URL içeriğini getir (resim desteği dahil) |
| `web_ara` | DuckDuckGo ile web araması yap |
| `web_search` | Detaylı web araması (başlık, URL, tarih) |

### Git

| Araç | Açıklama |
|------|-----------|
| `git_status` | Git durumunu göster (salt okunur) |
| `git_diff` | Git farkını göster (salt okunur) |
| `git_log` | Git geçmişini göster (salt okunur) |
| `repo_ozet` | Tek çağrıda depo özeti |

### Görev & Bellek

| Araç | Açıklama |
|------|-----------|
| `gorev_oku` | Oturum görev listesini oku |
| `gorev_yaz` | Oturum görev listesine yaz |
| `gorev_ekle` | Görev ekle |
| `gorev_guncelle` | Görev güncelle |
| `memory_read` | Proje kalıcı belleğini oku |
| `memory_write` | Proje kalıcı belleğine yaz |

### Ajan & MCP

| Araç | Açıklama |
|------|-----------|
| `agent_spawn` | Alt-ajan oluştur |
| `ask_user` | Kullanıcıya soru sor |
| `mcp_arac` | MCP sunucusunda araç listele / çağır |
| `arac_ara` | Hangi aracın ne işe yaradığını bul |
| `lsp_diagnostics` | Kod hatalarını ve uyarılarını listele |

### Siber Güvenlik

| Araç | Açıklama |
|------|-----------|
| `nmap` | Ağ tarama ve port keşfi |
| `sqlmap` | SQL injection testi |
| `nikto` | Web sunucu güvenlik açığı taraması |
| `gobuster` | Dizin ve dosya brute force taraması |
| `sethEngine` | SETH otonom operasyon motoru |

---

## 🧠 Kalıcı Bellek Sistemi

SETH, `~/.seth/memory/` altında 4 tip bellek tutar:

| Tip | Açıklama |
|-----|----------|
| `user` | Kullanıcı tercihleri, rol, bilgi seviyesi |
| `project` | Proje mimarisi, teknoloji stack'i |
| `feedback` | Geçmiş geri bildirimler |
| `reference` | Referans bilgiler, linkler |

```bash
/hafıza ekle user Kıdemli TypeScript geliştiricisiyim
/hafıza ekle project Bu proje Next.js + Prisma kullanıyor
/hafıza user          # user belleğini göster
/hafıza-temizle       # tümünü sil
```

---

## 🔒 Hook Sistemi

`~/.seth/hooks.json` ile araç çalışmadan önce/sonra otomatik komut çalıştırın:

```json
[
  { "event": "PreToolUse",  "tool": "file_write", "command": "git add -A" },
  { "event": "PostToolUse", "tool": "shell",       "command": "echo done", "async": true },
  { "event": "OnStart",                            "command": "echo 'SETH başladı'" }
]
```

---

## 🏗️ Mimari

```
src/
├── cli.ts              # CLI giriş noktası
├── repl.ts             # Etkileşimli REPL
├── headless.ts         # Headless mod
├── commands.ts         # Slash komutları
├── renderer.ts         # Çıktı render
├── welcome.ts          # Karşılama ekranı
├── theme.ts            # Tema sistemi (lazy, 6 tema)
├── hooks.ts            # Hook sistemi
├── lifecycle.ts        # Graceful shutdown, arka plan temizlik
├── semver.ts           # Semver karşılaştırma
├── security-report.ts  # LaTeX/PDF rapor üretici
├── history-search.ts   # Ctrl+R fuzzy arama
├── project-instructions.ts
├── prompts/
│   └── system.ts       # Sistem istemi
├── session-runtime.ts  # Oturum yönetimi
├── mcp/                # MCP istemcisi
├── providers/          # AI sağlayıcıları (Claude, Gemini, OpenAI, Ollama)
├── tools/              # Yerleşik araçlar (36 araç)
├── agent/              # Ajan döngüsü
├── config/             # Yapılandırma
└── storage/            # Oturum, geçmiş, bellek depolama
```

---

## 📋 Gereksinimler

- **Node.js** >= 18
- En az bir AI sağlayıcısı yapılandırılmış olmalı (Claude, Gemini, OpenAI veya Ollama)
- Siber güvenlik araçları için: `nmap`, `sqlmap`, `nikto`, `gobuster` (isteğe bağlı)
- PDF rapor için: `pdflatex` (isteğe bağlı, yoksa `.tex` dosyası üretilir)
- Hızlı arama için: `rg` (ripgrep) — yoksa Node.js fallback kullanılır

---

## 📄 Lisans

MIT © 2025
