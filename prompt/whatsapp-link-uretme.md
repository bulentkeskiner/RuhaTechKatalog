# Ruhatech WhatsApp "Satın Al" Linki - Şablon Prompt

Kullanım: "[Kategori/ürün adı] için link oluştur" dendiğinde, aşağıdaki kurallara göre o ürüne özel bir WhatsApp yönlendirme linki üretilir. Bu link Instagram Hikâye'deki "Bağlantı" sticker'ına veya "Satın Al" butonuna yapıştırılmak için kullanılır.

## Sabit Bilgiler

- WhatsApp numarası: 905456387347 (+90 545 638 73 47)
- Taban URL: `https://wa.me/905456387347?text=`

## Mesaj Şablonu

```
Merhaba, [ÜRÜN ADI] ürününü satın almak istiyorum. Fiyat bilgisi alabilir miyim?
```

- `[ÜRÜN ADI]` yerine `urun-fotolari/tek-urun/urun-aciklamalari.txt` dosyasındaki (veya `ruhatech-catalog.csv`'deki) ilgili ürünün TITLE / URUN alanı birebir kullanılır.
- Ürün, kategori adıyla değil (ör. "BT Kulaklık Grubu") o kategoriye ait spesifik ürün adıyla (ör. "AirPods Pro2 ANC") belirtilir. Kategori adı verilirse, önce o kategorideki ürün `urun-aciklamalari.txt` dosyasından bulunur.

## İşlem Adımları

1. İstenen ürünü/kategoriyi `urun-fotolari/tek-urun/urun-aciklamalari.txt` içinde bul (kategori verildiyse oradaki ürünü kullan).
2. Mesaj şablonunu ürün adıyla doldur.
3. Mesajı URL-encode et (Türkçe karakterler, boşluk, virgül, soru işareti dahil - `urllib.parse.quote` ile).
4. Taban URL ile birleştirip tek satır link olarak ver.

## Çıktı Formatı

```
**[Kategori — Ürün Adı]** için WhatsApp linki:

https://wa.me/905456387347?text=[url-encode edilmiş mesaj]

Tıklanınca WhatsApp'ta şu hazır mesajla açılır: "Merhaba, [Ürün Adı] ürününü satın almak istiyorum. Fiyat bilgisi alabilir miyim?"
```

## Örnek (referans)

**Araç Aksesuar — Araç Akü Takviye A7711** için WhatsApp linki:

https://wa.me/905456387347?text=Merhaba%2C%20Ara%C3%A7%20Ak%C3%BC%20Takviye%20A7711%20%C3%BCr%C3%BCn%C3%BCn%C3%BC%20sat%C4%B1n%20almak%20istiyorum.%20Fiyat%20bilgisi%20alabilir%20miyim%3F

## Kurallar

1. Her ürün için mesaj metni yukarıdaki şablona sadık kalır; sadece ürün adı değişir.
2. Link her zaman tek satır, boşluksuz ve tam URL-encode edilmiş olarak verilir.
3. Birden fazla ürün istenirse, her biri için ayrı başlık altında ayrı link üretilir.
4. Ürün `urun-aciklamalari.txt` içinde bulunamazsa, `ruhatech-catalog.csv` dosyasındaki `title` alanına bakılır.
