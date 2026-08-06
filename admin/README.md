# RuhaTech Yönetim Paneli — Kurulum

Firebase üzerinde çalışan, giriş korumalı bir ürün yönetim paneli. Ürünleri ekler/düzenler/silersiniz, panel size Facebook/Meta katalog beslemesine uygun bir CSV üretir.

Maliyet: Bu panel yalnızca **Authentication + Firestore + Hosting** kullanır — hepsi Firebase'in ücretsiz "Spark" planında, Cloud Functions veya Storage gerekmez.

---

## 1) Firebase projesi oluşturun

1. https://console.firebase.google.com adresine gidin, **Proje ekle**.
2. Proje adını girin (örn. `ruhatech-yonetim`), Google Analytics'i isterseniz kapatabilirsiniz.
3. Proje oluşunca sol menüden **Build > Authentication** açın → **Get started** → **Sign-in method** sekmesinde **E-posta/Şifre**'yi etkinleştirin.
4. **Authentication > Users** sekmesinde **Add user** ile kendinize bir admin hesabı oluşturun (e-posta + şifre). Panelde herkese açık kayıt ekranı yoktur — kullanıcılar yalnızca buradan elle eklenir.
5. Sol menüden **Build > Firestore Database** → **Create database** → **Production mode** → size yakın bir bölge (örn. `eur3`) seçip oluşturun.
6. Sol menüden ⚙️ **Project settings > General** sekmesine inin, "Your apps" altında **</> (Web)** simgesine tıklayıp bir web uygulaması kaydedin (Firebase Hosting kutucuğunu işaretlemenize gerek yok). Size bir `firebaseConfig` nesnesi verecek.

## 2) Config'i projeye yapıştırın

`admin/js/firebase-config.js` dosyasını açıp konsoldan aldığınız değerlerle `REPLACE_ME` yazan yerleri doldurun:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "ruhatech-yonetim.firebaseapp.com",
  projectId: "ruhatech-yonetim",
  storageBucket: "ruhatech-yonetim.appspot.com",
  messagingSenderId: "...",
  appId: "...",
};
```

Bu değerler gizli değildir (tarayıcıda herkes görebilir) — asıl güvenlik `firestore.rules` dosyasındaki kurallarla sağlanıyor: veriye yalnızca giriş yapmış kullanıcı erişebiliyor.

## 3) Firebase CLI ile deploy edin

Bilgisayarınızda [Node.js](https://nodejs.org) kurulu olmalı. Terminalde:

```bash
npm install -g firebase-tools
cd admin
firebase login
firebase use --add        # listeden az önce oluşturduğunuz projeyi seçin
firebase deploy
```

Bu komut hem güvenlik kurallarını (`firestore.rules`) hem de site dosyalarını yayınlar. Deploy bitince terminalde bir `https://PROJE-ID.web.app` adresi göreceksiniz — panel orada çalışır.

### Alt domain bağlama

Firebase Console'da **Hosting** sayfasında **Add custom domain** ile kendi alt domaininizi (örn. `yonetim.siteniz.com`) ekleyip DNS ayarlarını Firebase'in verdiği kayıtlarla eşleştirin.

## 4) Panele giriş yapın

`https://PROJE-ID.web.app` (veya bağladığınız alt domain) adresine gidin, 1. adımda oluşturduğunuz e-posta/şifre ile giriş yapın.

## 5) Mevcut kataloğu içeri aktarın

Panelde **Ürünler > CSV İçe Aktar** ile mevcut `ruhatech-catalog.csv` dosyanızı seçin. Aynı ürün kodu (id) varsa güncellenir, yoksa yeni eklenir — güvenle tekrar tekrar çalıştırabilirsiniz.

## 6) Facebook'a bağlama — otomatik yayınlama

Panel, her ürün ekleme/güncelleme/silme işleminden sonra katalogu **otomatik olarak** GitHub reponuzdaki CSV dosyasına yazar (Cloud Functions veya ücretli plan gerekmez — doğrudan tarayıcıdan GitHub API'sine yazılır). Bunun için bir kerelik ayar gerekiyor:

### a) GitHub Personal Access Token oluşturun

1. GitHub'da **Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token**.
2. **Repository access**: "Only select repositories" seçip yalnızca katalog reponuzu (örn. `RuhaTechKatalog`) seçin.
3. **Permissions > Repository permissions > Contents**: **Read and write** yapın. Başka hiçbir izne gerek yok.
4. Token'ı oluşturup kopyalayın (bir daha gösterilmez).

### b) Panelde ayarları girin

1. Panelde **Ürünler** sekmesinde **⚙ Facebook Bağlantısı** butonuna tıklayın.
2. GitHub kullanıcı adınızı, repo adını, branch'i (`main`) ve dosya yolunu (`ruhatech-catalog.csv`) girin.
3. Az önce oluşturduğunuz token'ı yapıştırın.
4. **Kaydet ve Test Yayınla**'ya basın — başarılıysa "Son yayın" tarihi görünür.
5. Görünen **Herkese Açık CSV Linki**'ni kopyalayıp Meta Commerce Manager'daki veri kaynağı (data feed) alanına yapıştırın.

Bundan sonra panelden yaptığınız her ekleme/düzenleme/silme işleminde katalog otomatik olarak bu linke yayınlanır; ayrıca istediğiniz an **Şimdi Yayınla** butonuyla elle de tetikleyebilirsiniz. CSV içe aktarma sonrasında da otomatik yayınlanır.

**Güvenlik notu:** Token, yalnızca giriş yapmış admin'in okuyabildiği Firestore'da saklanır (bkz. `firestore.rules`). Yine de token'ı yalnızca bu bir repoyla ve yalnızca "Contents: Read/write" izniyle sınırlı tutmanız (fine-grained token), sızması hâlinde etkiyi minimumda tutar.

### Görsel yükleme

Ürün ekle/düzenle formunda **Ana Görsel** ve **Ek Görseller** alanlarının yanında bir dosya seçici var — bilgisayarınızdan bir resim seçtiğinizde otomatik olarak aynı GitHub reposunun `urun-fotolari/` klasörüne yüklenir ve URL alanı otomatik doldurulur. Aynı şekilde **Ürün Videosu** alanı da bir video dosyası seçtiğinizde `urun-videolari/` klasörüne yükler (en fazla 40MB). Bunun çalışması için de yukarıdaki GitHub ayarlarının (owner/repo/branch/token) kayıtlı olması yeterli — Firebase Storage'a hiç ihtiyaç yok, bu yüzden Blaze plana geçmenize gerek kalmıyor.

### Sadeleştirilmiş ürün formu

Ürün ekle/düzenle sayfası yalnızca gerçekten kullandığınız alanları gösterir: Temel Bilgiler, Fiyat/Stok (yalnızca fiyat + stok durumu), Bağlantılar ve Görseller, Kategori (yalnızca yeni ürün eklerken görünür) ve Etiketler. "Durum" alanı artık sorulmaz, her kayıtta otomatik olarak "new" yazılır. Diğer tüm Facebook alanları (indirimli fiyat, GTIN, gönderim, ürün özellikleri, yasal notlar vb.) formda yok — her kaydettiğinizde bu alanlar otomatik olarak boşaltılır (eski içe aktarılmış verilerde kalan değerler de bir ürünü ilk kez bu panelden düzenlediğinizde temizlenir).

### Etiketler sayfası

Sol menüdeki **Etiketler** sayfasından Etiket 1/2/3 seçim listesini yönetirsiniz (ekle, yeniden adlandır, sil). Yeniden adlandırma, o etiketi kullanan tüm ürünlerde de otomatik günceller. Panel ilk açıldığında, ürünlerinizde zaten kullanılan etiket değerleri bu listeye otomatik olarak eklenir — elle bir şey yapmanıza gerek yok.

---

## Güvenlik notları

- **Giriş zorunlu:** `dashboard.html` açılışta oturum kontrolü yapar, oturum yoksa `index.html`'e yönlendirir.
- **Firestore kuralları** (`firestore.rules`): `products` ve `activity` koleksiyonlarına yalnızca `request.auth != null` (yani giriş yapmış) kullanıcılar erişebilir. Herkese açık okuma/yazma yoktur.
- **Herkese açık kayıt yok:** Yeni admin eklemek için Firebase Console > Authentication > Users üzerinden elle eklemeniz gerekir.
- **`noindex`:** Panel sayfaları arama motorlarına kapalıdır (`<meta name="robots" content="noindex, nofollow">`).
- Birden fazla kişiye erişim vermek isterseniz Authentication'dan yeni kullanıcı eklemeniz yeterli — kural zaten "giriş yapmış herkes" diyor. Daha ince yetkilendirme (örn. salt-okunur kullanıcı) isterseniz `firestore.rules` içine bir `admins` koleksiyonu kontrolü eklenebilir, isterseniz bunu birlikte yaparız.

## Dosya yapısı

```
admin/
  index.html          Giriş sayfası
  dashboard.html       Panel (Dashboard + Ürünler)
  css/style.css
  js/
    firebase-config.js Sizin dolduracağınız Firebase anahtarları
    firebase-init.js   Firebase başlatma
    schema.js           Ürün alanları (Facebook CSV sütunlarıyla birebir eşleşir)
    products-store.js   Firestore okuma/yazma
    csv.js               CSV <-> ürün dönüşümü
    utils.js             Yardımcı fonksiyonlar
    dashboard.js         Panelin tüm arayüz mantığı
  firebase.json
  firestore.rules
  firestore.indexes.json
  .firebaserc           Firebase proje ID'nizi buraya da yazın (default alanı)
```
