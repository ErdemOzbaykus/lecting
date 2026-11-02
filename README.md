# Lecting

Sınav haftası için yerel çalışma masası. Ders dosyalarını okul sitesinden çeker, her konu için not, test ve sesli özet üretir, sınav takvimine göre çalışma programı çıkarır.

- **Kaynaklar:** IEULearn'deki ders içeriği (PDF/PPTX, konu açıklamasındaki dosya bağlantıları dahil), elle yüklenen dosyalar ve YouTube videoları.
- **Notlar:** EVREN (OpenAI uyumlu API) ya da yerel `claude` CLI ile Markdown + KaTeX notlar, slayt görselleri ve video kareleri.
- **Test:** Çoktan seçmeli, boşluk doldurma, doğru/yanlış ve eşleştirme soruları; skorlar konu bazında tutulur.
- **Sesli özet:** EVREN TTS (`voxcpm2`), olmazsa macOS `say`.
- **Video:** Altyazı yoksa ses EVREN ASR (`qwen3-asr-1.7b`) ya da yerel whisper.cpp ile yazıya çevrilir.
- **Program:** Sınav tarihlerine ve günlük çalışma saatine göre konu planı.

## Kurulum

Gerekenler: Node 24, `ffmpeg`, `pdftotext` (poppler), `soffice` (LibreOffice, PPTX → PDF), `yt-dlp`. İsteğe bağlı: `whisper-cli` + model (`data/models/`), `claude` CLI.

```bash
brew install node ffmpeg poppler yt-dlp
brew install --cask libreoffice
npm install
npm start
```

Uygulama `http://127.0.0.1:3100` adresinde açılır. Ayarlar ekranından okul hesabı ve EVREN anahtarı girilir; bunlar yalnızca bu bilgisayardaki `.env` dosyasına yazılır.

Dersler `data/manifest.json` içinde tanımlanır (örnek: [manifest.example.json](manifest.example.json)). `courseId`, IEULearn'deki ders adresindeki sayıdır. "Eşitle" düğmesi konu listesini ve dosyaları siteden doldurur.

```bash
npm test
```

## Veri

Kişisel her şey git dışında kalır: `.env`, `data/` (ders dosyaları, ayarlar, skorlar) ve `lectures/` (üretilen notlar).

## Teşekkür

Not düzeni [LectNote](https://github.com/Berikai/lectnote)'tan alındı (Berikai ve LectNote katkıcıları, MIT). Notlar `lectures/<DERS>/<NN-konu>/notes.md` olarak yazılır; bu klasör LectNote'ta çalışma alanı olarak açılabilir, LectNote'un MCP sunucusuyla da okunabilir.

## Lisans

MIT, bkz. [LICENSE](LICENSE).
