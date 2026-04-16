# SETH — Proje Rehberi ve Geliştirme Notları

Bu belge (hakkinda.md), "SETH" projesinin ne olduğunu, şimdiye kadarki geliştirilme sürecini, mevcut mimarisini ve gelecekteki olası (daha gelişmiş) asistanlar tarafından devralınması halinde ihtiyaç duyacakları teknik bağlamı içermektedir.

## 1. SETH Nedir?
**SETH**, *Anthropic Claude Code* ve *Qwen Code* gibi araçlardan ilham alınarak, terminal ortamında yerelden (`ollama`) veya bulut üzerinden (`claude`, `openai`, `gemini`) çalışabilen interaktif, soğuk, otoriter ve direktif odaklı bir **Yapay Zeka Kod Asistanı** (AI Coding Agent) replikasıdır. 
Proje, kullanıcıya dosya işlemleri, terminal komut çalıştırma (`shell`) ve arama (`grep` vb.) gibi araçlar sunarak, otomatize edilmiş "Otonom Yazılım Geliştirici" hissi veren bir CLI arayüzüne sahiptir. Sloganı "HİÇBİR SİSTEM GÜVENLİ DEĞİLDİR"dir.

## 2. Kullanılan Stack & Altyapı
- **Dil:** TypeScript, Node.js (`src/` dizini)
- **Modül Sistemi:** ESM (ECMAScript Modules)
- **Arayüz (UI):** 
  - `@clack/prompts`: Kurulum ve "Tool Permission" menüleri için.
  - `ora`: Spinners (Yükleme çarkları) için.
  - `marked` & `marked-terminal`: Markdown çıktılarını terminale estetik bir şekilde boyamak için.
- **Ajans Mimarisi:** Temel bir "Ajan Döngüsü" (Agent Loop) bulunmaktadır. LLM araç kullanım (tool_use) döndüğünde, sistem parçayı işler ve geri cevap verir. `runAgentLoop` => `repl.ts` => `tools/executor.ts`.

## 3. Dizindeki Temel İskelet (Klasör Yapısı)
* `src/cli.ts`: Ana giriş, argümanları ayrıştırır. `seth` komutunun kalbidir.
* `src/headless.ts`: Etkileşimsiz, tek komutluk `-p "soru"` modu.
* `src/repl.ts`: Sınırsız sohbet (REPL) döngüsüdür. `readline` ve süreç işlemleri burada yürür.
* `src/onboarding.ts`: Uygulama ilk açıldığında çalışan **Kurulum Sihirbazı**. Kullanıcıya favori modelini sorar.
* `src/agent/loop.ts`: Ajan döngüsü. Maksimum döngü ve token bütçesi izlenir.
* `src/tools/`: Asistanın gerçek dünya yetenekleri. (Dosya okuma, komut çağırma (`executor.ts`), arama vb.)
* `src/providers/`: Ollama, OpenAI, Google ve Claude için entegrasyon API modülleri. SETH bu servislere evrensel bir formatla ileti yollar.
* `src/config/settings.ts`: Konfigürasyon yönetimi. Configler `~/.seth/settings.json` lokasyonunda tutulur.
* `src/renderer.ts`: Renklendirme ve spinnner modülüdür. *Son haldeki "çift yazdırma" hataları burada onarıldı.*

## 4. Mevcut Araçlar (Tools) — v1.1
SETH şu an **8 adet yerleşik araç** ile geliyor:

| Araç | Açıklama |
|------|----------|
| `shell` | Terminal komutu çalıştırır (PowerShell/Bash, cross-platform) |
| `file_read` | Dosya içeriğini satır numaralı olarak okur |
| `file_write` | Dosya oluşturur veya üzerine yazar |
| `file_edit` | Dosyada string değiştirir (renkli diff çıktısı ile) |
| `search` | Dosyalarda metin arar (ripgrep/grep, regex, context lines, file type filter) |
| `list_directory` | Dizin içeriğini tree benzeri listeler (emoji ikonları ile) |
| `glob` | Pattern ile dosya bulur (`*.ts`, `**/*.json` gibi) |
| `batch_read` | Birden fazla dosyayı tek seferde okur |

## 5. Şimdiye Kadar Çözülen Temel Problemler (Tarihçe)
Proje sıfırdan geliştirildikten sonra son birkaç oturumda uygulanan **kritik UX (Kullanıcı Deneyimi)** onarımları:

- **OS Awareness (İşletim Sistemi Farkındalığı):** Artık sistem, Windows/Linux ortamlarından hangisinde koştuğunu algılayabiliyor (`os.type()`). Böylece ajan, komut yazarken (Shell vb.) Windows'ta PowerShell kurallarına dikkat etmesi gerektiğini anlıyor.
- **"@clack/prompts" Event Loop Hatası (Çıkış Yapma Bug'ı):** Menülerden, sihirbazdan veya terminal `onay` dialoglarından ("İzin veriyor musun? Yes/No") çıkıldığında Node.js, standart girdiyi koparttığı için uygulama kendini kapatıyordu. `process.stdin.resume()` mekanizması aralara inject edilerek **ani REPL çöküşleri engellendi.**
- **Ctrl+C Jenerasyon İptali:** Özellikle lokal (`Ollama`) modeller bazen sonsuz döngüye girdiklerinde terminal donuyordu. `AbortController` bağlanarak, Claude Code'da olduğu gibi jenerasyon esnasında Ctrl+C kullanımı ile AI düşünmesini iptal etme / güvenli kaçış mekanizması eklendi.
- **Markdown Parse Hatası:** AI dönütlerinin iki kere yazılması ve içine `<p>` HTML etiketlerinin (Terminalde) sızması sorunu `markedTerminal` in son sürüme göre regüle edilmesi ile düzeltildi.
- **Onboarding Sihirbazı:** İlk defa çalıştırtıldığında (config dosyası yok ise) otomatik menü kurulumuna geçiş yapıldı.
- **Yeni Araçlar (v1.1):** `list_directory`, `glob`, `batch_read` araçları eklendi. `search` aracı geliştirildi (context lines, file type filter, max depth, exclude pattern).
- **Renkli Diff Çıktısı:** `file_edit` aracı artık değişiklikleri renkli diff formatında gösteriyor.
- **Rebranding - SETH:** Proje EdaCode'dan alınıp SETH ismine dönüştürüldü. ANSI kırmızı logolar oluşturuldu, otoriter ton adapte edildi, logger formatı "SETH: ... yapılıyor" olarak güncellendi ve tüm dosya yolları `.seth`'e çekildi.

## 6. Gelecekteki veya Gelişmiş "Yapay Zeka" Modeline Notlar (Yaklaşım Rehberi)
Sonraki asistanlar projenin bu halini devraldığında şunları yapabilir:

1. **PTY Tabanlı Shell:** Mevcut `spawn` mimarisi basit shell çalıştırır. Canlı (PTY tabanlı) terminal araçları eklenirse `npm install` gibi interaktif komutlar daha şık çalışabilir. (`node-pty` paketi düşünülebilir)
2. **Paralel Tool Execution:** Agent loop şu an araçları sırayla çalıştırıyor. Birden fazla bağımsız araç çağrısı paralel çalıştırılabilir.
3. **Tool Result Caching:** Aynı dosya tekrar tekrar okunuyorsa cache'leme yapılabilir.
4. **LSP Entegrasyonu:** TypeScript/Python Language Server Protocol entegrasyonu ile daha akıllı kod analizi yapılabilir.
5. **TypeScript Build:** Projeyi derleyip linklemek için şu komutu sık sık kullanmalısın: `npm run build && npm link`. Build olmadan değişiklikler aktif olmaz.
6. **Dikkat Edin:** `readline` interaktif döngüsü içindeki `pause()` ve `resume()` yapısını kırmayın, yoksa @clack Prompt'ları event loop'u durduruyor!
