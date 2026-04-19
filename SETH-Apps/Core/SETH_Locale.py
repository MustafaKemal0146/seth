# SETH Otonom Siber Operasyon Ajanı - Dil ve Mesaj Entegrasyon Dosyası
# Sadece %100 Türkçe, profesyonel, soğuk ve agresif siber güvenlik standartlarına uygun terimler.

_current_language = "TR"

messages = {
    "SCAN_STARTING": "[+] Operasyon başlatılıyor: Hedef {target}",
    "SCAN_COMPLETED": "[+] Operasyon tamamlandı: Hedef {target}",
    "EXPLOIT_SUCCESSFUL": "[!] İstismar başarıyla gerçekleştirildi.",
    "EXPLOIT_FAILED": "[-] İstismar başarısız.",
    "VULN_FOUND": "[!] Zafiyet tespit edildi: {vuln}",
    "REPORT_GENERATED": "[+] Otonom operasyon raporu oluşturuldu: {file}",
    "SHUTTING_DOWN": "SETH operasyonu sonlandırıyor...",
    "BANNER_SUBTITLE": "SETH CORE - Otonom Siber Operasyon ve Sızma Testi Ajanı",
    "INSTALL_HEADER": "SETH ARAÇ KURULUMU",
    "LATERAL_MOVEMENT": "Yatay hareket (Lateral Movement) başlatılıyor...",
    "DATA_EXFILTRATION": "Veri sızdırma (Data Exfiltration) protokolü devrede.",
    "BRUTE_FORCE_INIT": "Kaba kuvvet (Brute-Force) saldırısı başlatılıyor...",
    "TARGET_ANALYSIS": "Kurban analizi devam ediyor...",
    "NO_SYSTEM_SAFE": "Bu operasyon SETH otonom siber güvenlik ajanı tarafından gerçekleştirilmiştir. Hiçbir sistem güvenli değildir.",
    "AI_CONFIG_TITLE": "SETH YAPAY ZEKA YAPILANDIRMASI",
    "AI_ENABLE_PROMPT": "Yapay zeka (LLM) otonomi desteği aktif edilsin mi? (E/H): ",
    "AI_SERVICES": "1. Gemini\n2. OpenAI\n3. Claude\n4. Ollama",
    "AI_SELECTION": "Servis Seçiniz (1/4): ",
    "API_KEY": "API Anahtarını Giriniz: ",
    "VIEWDNS_TITLE": "VIEWDNS API YAPILANDIRMASI",
    "VIEWDNS_INFO_1": "Ters IP ve DNS keşfi için ViewDNS.info API anahtarı önerilir.",
    "VIEWDNS_INFO_2": "Ücretsiz bir anahtar almak için https://viewdns.info/api/ adresine bakabilirsiniz.",
    "VIEWDNS_PROMPT": "API anahtarı girmek istiyor musunuz? (E/H): ",
    "VIEWDNS_KEY_PROMPT": "ViewDNS API Anahtarı: ",
    "KEY_SAVED": "Anahtar başarıyla kaydedildi.",
    "NO_KEY_WARNING": "Anahtar girilmedi, bazı gelişmiş özellikler kısıtlı olabilir.",
    "NO_KEY_INFO": "İşleme anahtarsız devam ediliyor.",
    "VIEWDNS_LATER_MSG": "Daha sonra {file} üzerinden güncelleyebilirsiniz.",
    "CONFIG_SAVED": "Yapılandırma başarıyla kaydedildi.",
    "INSTALLED_TOOLS": "Kurulu Araçlar ({count}): {tools}",
    "MISSING_TOOLS": "Eksik Araçlar ({count}): {tools}",
    "ALL_INSTALLED": "Tüm gerekli operasyonel araçlar yüklü.",
    "AUTO_INSTALL": "Eksik araçlar otomatik olarak kurulmaya çalışılıyor..."
}

def get_text(key, **kwargs):
    text = messages.get(key, f"[MISSING_TEXT: {key}]")
    if kwargs:
        try:
            return text.format(**kwargs)
        except KeyError:
            return text
    return text

def set_language(lang):
    global _current_language
    _current_language = lang
