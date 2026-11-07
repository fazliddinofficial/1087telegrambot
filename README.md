# Taksi balans boti

Haydovchi balansini to'ldirish uchun ofisga kelmaydi: kartaga pul o'tkazib, chekni Telegram Mini App orqali yuboradi. Dispetcher tekshiradi va balansni o'z web dasturida qo'lda to'ldiradi.

Bot taksi dasturi bilan bog'lanmaydi va haqiqiy balansni bilmaydi. Uning vazifasi to'lov ma'lumotini dispetcherga yetkazish, kim nima qilganini saqlash va haydovchiga natijani aytish.

## Rollar

| Rol | Imkoniyatlar |
|---|---|
| Haydovchi | Ro'yxatdan o'tadi, kartani ko'radi, chek yuboradi, to'lovlar tarixi va holatini ko'radi |
| Operator | Barcha kutilayotgan cheklarni ko'radi, oladi, tushiradi yoki rad etadi |
| Super admin | Operator imkoniyatlari, barcha to'lovlar va filtrlar, operatorlar ro'yxati, karta almashtirish |

Super admin faqat `.env` orqali belgilanadi: `SUPER_ADMIN_PHONES` (telefon raqami) yoki `SUPER_ADMIN_IDS` (Telegram ID). Raqam yoki ID ro'yxatdan olib tashlansa, huquq darhol yo'qoladi.

Telefon raqami bilan kirish uchun admin botga `/admin` yozadi va «Raqamni ulashish»ni bosadi. Raqam Telegram hisobining o'zidan tasdiqlanadi. Username ataylab ishlatilmaydi: u o'zgaradi va bo'shagan nomni boshqa odam olishi mumkin.

## To'lov oqimi

`Yangi → Operatorda → Tushirildi` yoki `Rad etildi`

1. Haydovchi chek yuboradi, bot uni barcha operator va super adminlarga yuboradi.
2. Xodim «Oldim»ni bosadi. Bir vaqtda bosilsa, faqat bittasi oladi, qolganlarda xabar yangilanadi.
3. Xodim kartaga pul tushganini tekshiradi, web dasturda balansni to'ldiradi va «Tushirdim»ni bosadi yoki sabab bilan rad etadi.
4. Haydovchiga natija boradi.

Olinmagan to'lov uchun har 10 daqiqada operatorlarga, 30 daqiqadan beri qo'lda turgani uchun esa uni olgan xodim va super adminga eslatma boradi.

## Operator qo'shish

1. Super admin Mini App'da **Operatorlar → Operator qo'shish** orqali ism va Telegram raqamini kiritadi.
2. Hosil bo'lgan bir martalik havolani operatorga yuboradi (24 soat amal qiladi).
3. Operator havolani ochib, botda «Raqamni ulashish»ni bosadi. Raqam mos kelsa, operator bo'ladi.

## Sozlash

1. [@BotFather](https://t.me/BotFather) orqali bot yarating, token va nomini oling.
2. `.env.example` asosida loyiha ildizida `.env` yarating. Tokenni hech kimga yubormang.
3. `SUPER_ADMIN_PHONES` ga Telegram hisobingizdagi telefon raqamini yozing.
4. Botni ishga tushirgach, botga `/admin` yozib, raqamingizni ulashing.

Birinchi kirishdan keyin super admin **Karta** bo'limida to'lov kartasini kiritishi kerak, aks holda haydovchilar to'lov yubora olmaydi.

## Lokal ishga tushirish

Mongo sifatida Docker'dagi `mongo` yoki vaqtinchalik baza (`npm run dev:db`, to'xtatilganda ma'lumot o'chadi) ishlatiladi.

```bash
npm install --prefix server
npm install --prefix webapp
npm run dev:db --prefix server
npm run dev --prefix server
npm run dev --prefix webapp
```

Mini App Telegram ichida faqat `https` orqali ochiladi. Sinov uchun tunnel oching va uning manzilini `WEBAPP_URL` ga yozing:

```bash
cloudflared tunnel --url http://localhost:5180
```

### Telegram'siz brauzerda sinash

`.env` da `BOT_POLLING=false` bo'lsin. Sinov ma'lumotlarini yarating va kerakli foydalanuvchi uchun imzo oling:

```bash
npm run dev:seed --prefix server
npm run dev:init-data --prefix server -- 2001
```

Chiqqan qatorni brauzer konsolida `localStorage.setItem('devInitData', '...')` qilib saqlang va sahifani yangilang. Bu faqat dev rejimda ishlaydi. ID'lar: `2001` haydovchi, `3001` operator, `1000` super admin.

## Serverga chiqarish

```bash
docker compose up -d --build
```

Ilova `127.0.0.1:4020` da ishlaydi, Mini App ham, API ham shu portdan beriladi. Nginx va HTTPS sertifikatini shu portga yo'naltiring, `WEBAPP_URL` ga domenni yozing.

Bazani (`mongo-data`) va cheklarni (`uploads`) zaxiralab turing.

## Tekshiruvlar

```bash
npm test --prefix server
npm run typecheck --prefix server
npm run build --prefix webapp
```

## Tuzilma

- `server/` — Telegraf bot, Express API, Mongoose modellari. Bitta jarayonda ishlaydi.
- `webapp/` — Vite'dagi Mini App. Kod React uslubida yozilgan, ishlashda hajmi kichik Preact ishlatiladi. Rolga qarab turli ekran ko'rsatadi.
