# Dizindeki Dosyaları İncelemek İçin Yardıma İhtiyacım Var

Dizin içeriğini doğrudan göremiyorum. Lütfen aşağıdakilerden birini paylaşır mısınız?

**1. Dosya listesi:**
```bash
ls -la /home/ara/Desktop/seth-github/seth-main
find /home/ara/Desktop/seth-github/seth-main -type f -name "*.json" -o -name "*.js" -o -name "*.py" -o -name "*.md" -o -name "*.html" -o -name "*.css" 2>/dev/null | head -50
```

**2. Önemli dosyaların içeriği:**
- `package.json` veya `requirements.txt`
- `README.md`
- Ana yapılandırma dosyaları

---

**Alternatif olarak**, terminal çıktısını doğrudan yapıştırabilirsiniz:

```
/home/ara/Desktop/seth-github/seth-main/
├── dosya1
├── dosya2
└── ...
```

Bu bilgileri aldığımda, projenin yapısını analiz edip sizin için kısa ve teknik bir `project.md` hazırlarım.