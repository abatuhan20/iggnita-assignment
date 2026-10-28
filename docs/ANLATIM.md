# Bu proje ne yapıyor? (Türkçe anlatım, sadece senin için)

## 1. Task senden ne istiyor?

Iggnita santral (jeneratör) kuruyor. Bir **proje** = bir müşterinin sahasına kurulan santral.
Projenin içinde bir veya daha fazla **unit** (jeneratör seti) var. Örneğin P-001'de Unit 1, 2, 3.

- **Unit** = tek bir jeneratör. Motoru, alternatörü, kendine ait görevleri vardır.
- **Phase** = aşama: Survey → Design → Procurement → Installation → Commissioning → Handover.
- **Gate** = bir sonraki aşamaya geçmek için şart. Örn. Procurement'a girmek için müşteri tasarım onayı lazım.
- **NCR-014** = sahada Unit 2'nin testi kalmış. Sebep tasarım (alternatör küçük). Unit 2 Design'a geri dönüyor,
  Unit 1 ve 3 yoluna devam ediyor.

Senden istenen: bir proje yöneticisinin bunları takip edip DEĞİŞTİREBİLDİĞİ küçük bir uygulama.
En zor kısım (puanın %25'i): Unit 2 geri giderken **diğerleri etkilenmesin** ve **geçmiş silinmesin**.

## 2. Fikir tek cümlede

> Hiçbir şeyi güncellemiyoruz. Sadece "ne oldu" kayıtlarını (event) ekliyoruz; şu anki durumu bu kayıtlardan hesaplıyoruz.

Bu yüzden Unit 2 geri giderken eski kayıt silinmiyor, sonuna yeni bir kayıt ekleniyor ("NCR-014 açıldı").

## 3. Requirement → kodda nerede?

| Requirement | Ne istiyor | Kodda nerede | Testte nerede |
|---|---|---|---|
| **R1** Portföy ve proje görünümü | Projelerin listesi; bir projenin unit/ekipman/görev/dokümanları; düz cümleyle "Unit 1 ve 3 hazır, Unit 2 Design'da" | `lib/summary.js` (`portfolio`, `summaryText`, `projectDetail`), `app/page.js`, `app/projects/[id]/page.js` | `ncr014.test.js`: "plain-words summary" |
| **R2** Gate'ler, sebebiyle | Aşama geçişi sadece şart sağlanınca; engel varsa NEDEN | `lib/gates.js` (`evaluateGate`), `lib/commands.js` (`advanceUnit`, `advanceEquipment`) | `gates.test.js` (hepsi) |
| R2 ekipman durumu | Ordered→Delivered→Installed→Commissioned, tarihiyle | `commands.advanceEquipment`, `state.js` (`equipment.advanced`) | `gates.test.js`: "moving equipment..." |
| R2 kısmi handover | Bazı unitler Handover'a geçebilir | Faz **unit'te** tutulur: `state.js` (`unit.phase`) | `ncr014.test.js`: "partial handover" |
| **R3** Load test | CSV içe aktar, her unit pass/fail; bozuk veriyi yakala; elle sonuç gir | `lib/loadtest.js`, `commands.importLoadTest`, `commands.recordLoadTest`, panel: `app/Controls.js` (`LoadTestPanel`) | `loadtest.test.js` (hepsi) |
| **R4** İş geri gider | Issue aç, SADECE seçili unit'leri önceki aşamaya gönder; neyin geçersiz kaldığını göster; geçmişi silme; Unit 2 aynı gate'lerden tekrar ilerlesin; NCR-014 hard-code olmasın | `commands.raiseIssue`, `lib/rules.js`, `state.js` (`case 'issue.raised'`), `summary.js` (`validityReport`), form: `Controls.js` (`RaiseIssueForm`) | `ncr014.test.js` (hepsi) |
| **R5** Geçmiş | Kim, ne, ne zaman; sadece ekleme; Unit 2'nin hikâyesi okunabilsin | `lib/engine.js` (`dispatch` log'a ekler), `lib/history.js`, `data/events.jsonl` | `ncr014.test.js`: "append-only", "history of Unit 2" |
| README / varsayımlar | Nasıl çalışır, load-test kararları, "part" tanımı | `README.md` | (okuma) |
| Design note | 3 soru, 400 kelime | `DESIGN_NOTE.md` | (okuma) |

## 4. Bir isteğin yolculuğu (örnek: "Unit 2'yi Procurement'a taşı" butonu)

1. Tarayıcı: `app/Controls.js` → `ActionButton` → `POST /api/projects/P-001/actions` `{action: "advanceUnit", unitId: "U2"}`
2. `app/api/projects/[id]/actions/route.js` isteği alır, `engine.dispatch("advanceUnit", ...)` çağırır.
3. `lib/engine.js` `dispatch`: komutu bulur, **kuralları kontrol ettirir**.
4. `lib/commands.js` `advanceUnit` → `lib/gates.js` `evaluateGate`: "Unit 2 için geçerli design_approval var mı?"
   - Yoksa hata + sebep listesi döner, hiçbir şey yazılmaz. Ekranda kırmızı yazar.
   - Varsa `unit.advanced` olayı döner.
5. Engine olaya numara, zaman, kullanıcı ekler ve `data/events.jsonl` dosyasına **ekler**.
6. Sayfa yenilenir; `lib/state.js` seed + tüm olayları baştan uygulayıp yeni durumu hesaplar.

## 5. NCR-014 nasıl çalışıyor?

`raiseIssue` tek bir olay üretir; içinde şunlar var: referans, açıklama, kimin/ne zaman, **hangi unit'ler**, **hangi aşamaya**,
neyin geçersiz olduğu, yeni alternatör siparişi. `state.js` bunu uygularken:

- Sadece Unit 2'nin fazı Design olur. Unit 1 ve 3'e dokunulmaz.
- D-102'ye "Unit 2 için geçersiz" notu düşer (silinmez), böylece Unit 1 ve 3 için hâlâ geçerli.
- Eski alternatör "geçersiz" olur, yeni ALT-2.5-B kaydı **eklenir** (10 hafta).
- T-1204/5/6 "yeniden yapılmalı" olur; T-1201/2/3 (motor temeli, egzoz, yakıt) dokunulmaz.
- Unit 2'nin test sonucu geçersiz olur ama geçmişte kalır.

Unit 2 sonra **aynı** `evaluateGate` ile ilerler: yeni onay → Procurement; yeni alternatör teslim → Installation;
görevler tekrar → Commissioning; yeni test + rapor → Handover. Özel kod yok.

## 6. Load test dosyasındaki tuzaklar (R3)

Dosyada bilerek bozuk satırlar var: `" U1"`, `"u3"`, MW cinsinden değerler, tekrar eden satır, `99999` sensör hatası, boş değer,
U3'te eksik 10:45 okuması. `lib/loadtest.js` hepsini yakalar ve kullanıcıya listeler.
En ince nokta U3: eksik okuma yüzünden katı kuralla kalıyor ama bu bir "yorum" meselesi. Brief de "U1 ve U3 geçti kabul et,
kuralın aksini söylüyorsa mühendis onayı kaydet" diyor; biz de Kemal'in elle pass kaydını yapıyoruz.

## 7. Task'ın doğru tamamlandığını nasıl kontrol edersin?

**A. Otomatik (1 dakika)**
```bash
npm install
npm test        # 38 test yeşil olmalı
npm run demo    # NCR-014 senaryosunu terminalde baştan sona oynatır
```
`npm run demo` çıktısında şunları gör: U1 PASS / U2 FAIL / U3 FAIL (judgement call); NCR-014 sonrası
"Units 1 and 3 in Commissioning; Unit 2 back in Design (NCR-014)."; D-102 sadece Unit 2 için geçersiz;
T-1204/5/6 geçersiz, T-1201/2/3 geçerli; Unit 2'nin tarihçesi.

**B. Brief'teki "What we will check" listesi → hangi test kanıtlıyor**

| Brief'in kontrol maddesi | Test (`test/ncr014.test.js`) |
|---|---|
| Unit 1 ve 3 Commissioning'de, geçti, rapor gelince Handover | "Units 1 and 3 have passed... wait only for the commissioning report" |
| Unit 2 Design'da | "Unit 2 is back in Design, Units 1 and 3 stay in Commissioning" |
| D-102 U1/U3 için geçerli, U2 için değil | "design approval D-102 stays valid..." |
| ALT-2.1-A geçersiz, ALT-2.5-B yeni sipariş 10 hafta, eski kayıt duruyor | "Unit 2 alternator is invalid and replaced..." |
| T-1204/5/6 geçersiz; motor, T-1201/2/3 geçerli | "exactly T-1204, T-1205, T-1206 must be redone..." |
| Unit 2 test sonucu geçersiz, başarısız sonuç tarihçede | "Unit 2 load-test result is invalid, but ... stays" |
| Proje geneli ögeler geçerli | "project-wide items stay valid" |
| Tarihçe silinmez | "NCR-014 is append-only" |
| Unit 2 aynı gate'lerden ilerler | "Unit 2 travels forward through the SAME gates" |
| NCR-014 hard-code değil | "NCR is not hard-coded: P-002 Unit 1..." |

**C. Elle (README'deki tıklama yolu):** `npm run dev` → P-001 → load test import → Unit 3 elle pass → NCR-014 aç → sayfadaki cümleyi ve geçerli/geçersiz tabloyu gör → Unit 2 geçmişini aç.

**D. Brief'in kendi kontrol listesi (teslimden önce)**
- [ ] README: nasıl çalıştırılır, NCR-014 nasıl oynatılır, varsayımlar, "part" tanımı ✓ (README.md)
- [ ] Testler: gate, load test, NCR-014 ✓
- [ ] Design note ≤ 400 kelime e-posta gövdesinde (kendi cümlelerinle düzenle)
- [ ] AI USE: hangi araç, ne için, nerede düzelttin (dürüst yaz)
- [ ] Harcadığın saat
- [ ] "Kendi işim, AI yardımını yukarıda belirttim" cümlesi
- [ ] Commit geçmişi korunmuş (squash/force-push yok)
