# Integracija Pulse-a na tvarenasport.com

Namenjeno **Arena razvojnom timu**. Ukupno posla: jedan `<script>` tag i jedan
objekat sa metapodacima u `<head>`.

---

## 1. Učitavanje SDK-a

U `<head>`, uvek sa `async` — nikad blocking:

```html
<script async src="https://pulse.tvarenasport.com/pulse.js" data-site="rs"></script>
```

`data-site` je `rs` | `hr` | `ba` | `si`. Ako se izostavi, server ga izvodi iz domena.

SDK je 2,8 KB gzipped, bez zavisnosti, i sve radi u `try/catch` — ne može da sruši
stranicu ni ako endpoint ne odgovara.

---

## 2. `window.pulseMeta` — jedini pravi zahtev

Ovo je **preduslov** za analitiku po autoru, kategoriji i tagu. Postavlja se u `<head>`,
**pre** učitavanja SDK-a, na svakoj stranici članka:

```html
<script>
window.pulseMeta = {
  articleId:   "76177",
  title:       "Saša Ilić posle derbija: Nismo zaslužili poraz",
  author:      "milan-nastic",
  category:    "fudbal/superliga-srbije",
  tags:        ["sasa-ilic", "fk-partizan", "superliga-srbije"],
  publishedAt: "2026-08-24T00:03:00Z",
  contentType: "news",
  wordCount:   420
};
</script>
```

### Polja

| Polje | Tip | Obavezno | Napomena |
|---|---|---|---|
| `articleId` | string | **da** | ID iz CMS-a; mora biti stabilan |
| `title` | string | preporučeno | bez njega dashboard prikazuje ID umesto naslova |
| `author` | string | **da** | slug, ne puno ime: `milan-nastic` |
| `category` | string | **da** | hijerarhijski, kosom crtom: `fudbal/superliga-srbije` |
| `tags` | string[] | da | slug-ovi, do 25 po tekstu |
| `publishedAt` | ISO 8601 | da | **u UTC**, sa `Z` na kraju |
| `contentType` | string | da | `news` \| `live-blog` \| `video` \| `column` \| `static` |
| `wordCount` | number | da | broj reči u telu teksta bez HTML-a |

### Zašto je svako polje bitno

- **`author` kao slug** — isti autor mora imati isti string na svakom tekstu, inače se
  statistika deli na dva reda. „Milan Nastić" i „milan nastic" su za bazu dva autora.
- **`category` hijerarhijski** — `category_root` (`fudbal`) se izvodi automatski iz dela
  pre prve kose crte. To omogućava drill-down `fudbal` → `fudbal/superliga-srbije` → tekst.
- **`publishedAt` u UTC** — sve u bazi je UTC, prikaz je Europe/Belgrade. Lokalno vreme
  sa CEST pomerajem razbija dnevne izveštaje oko ponoći.
- **`contentType: "live-blog"`** — live blogovi se **izbacuju** iz proseka vremena na
  stranici. Bez ove oznake jedan meč od tri sata iskrivi prosek svim ostalim tekstovima.
- **`wordCount`** — bez njega nema *read completion rate*, jer se ne zna koliko je vremena
  potrebno da se tekst pročita.

### Na stranicama koje nisu članak

Naslovna, kategorijske strane, TV šema:

```html
<script>
window.pulseMeta = { contentType: "homepage" };   // ili "category" / "static"
</script>
```

---

## 3. Consent (GDPR)

Sajt pokriva SRB + EU (Slovenija, Hrvatska), pa se GDPR primenjuje.
Pulse **ne postavlja nikakav dugoročni ID dok ne dobije consent**.

Kad korisnik prihvati analitičke kolačiće:

```js
window.pulse.consent(true);
```

Kad odbije ili povuče saglasnost:

```js
window.pulse.consent(false);   // briše postojeći visitor_id
```

Bez consent-a SDK radi u **cookieless režimu**: pageview se broji, sesija postoji
(sessionStorage, 30 min), ali nema `visitor_id` i **ne beleže se koordinate klikova**
(bez heatmape).

Pozovite `consent()` odmah po odluci korisnika, i pri svakom učitavanju stranice ako
odluku čuvate u sopstvenom CMP-u.

---

## 4. Šta SDK meri sam

Ništa od ovoga ne zahteva dodatni kod:

| Event | Kada |
|---|---|
| `pageview` | odmah po učitavanju |
| `scroll_depth` | na 25 / 50 / 75 / 100 %, svaki jednom |
| `time_on_page` | pri napuštanju — **samo aktivno vreme**, ne računa se dok je tab u pozadini |
| `click` | delegirano: linkovi, dugmad, `[data-pulse-cta]` |
| `video_play` / `video_progress` | za `<video>` elemente na stranici |

Slanje ide u batch-evima na 5 sekundi i preko `sendBeacon` pri napuštanju stranice.

---

## 5. Opcione integracije

### Live blog

Označite kontejner u koji stižu novi postovi:

```html
<div class="live-feed" data-pulse-liveblog>
  <article class="live-post">…</article>
</div>
```

SDK preko `MutationObserver` beleži `live_blog_update` kad stigne novi post dok je
korisnik na stranici. To pokazuje koliko engagement-a nosi meč u toku.

### Video

`<video>` elementi se hvataju automatski. Za jasnije razlikovanje u izveštajima:

```html
<video data-pulse-video="derbi-golovi" src="…"></video>
```

YouTube iframe se **ne meri** — za to bi bio potreban YouTube IFrame API,
što je izvan dogovorenog obima.

### A/B testovi naslova

Dva načina.

**A) Naslov renderuje CMS** — pitajte Pulse koju varijantu da prikažete:

```js
window.pulse.headline("76177", function (test) {
  if (test) {
    document.querySelector("#naslov-76177").textContent = test.headline;
  }
});
```

Poziv sam beleži `ab_exposure`. Dodela je deterministička po sesiji — isti korisnik
uvek vidi istu varijantu.

**B) Naslovi se renderuju server-side** — označite element:

```html
<a href="/fudbal/76177"
   data-pulse-ab-test="ab_9f3c1e"
   data-pulse-ab-variant="B">Saša Ilić: Nismo zaslužili poraz</a>
```

SDK preko `IntersectionObserver` beleži izloženost kad element uđe u vidno polje
(50% vidljivosti), a klik automatski vezuje za istu varijantu.

### SPA navigacija

Ako se stranice menjaju bez ponovnog učitavanja:

```js
window.pulseMeta = { /* novi metapodaci */ };
window.pulse.page();
```

---

## 6. Provera da li radi

1. Otvorite članak, pa DevTools → Network → filter `collect`.
2. Očekivano: `POST /collect` sa `204 No Content` u roku od nekoliko sekundi.
3. U konzoli `window.pulseMeta` mora da vrati popunjen objekat — najčešća greška je da
   ga CMS postavi *posle* SDK-a ili da ga preskoči na nekim šablonima.
4. U Pulse dashboard-u, ekran **Pregled** → „Najčitanije upravo sada" pokazuje tekst
   u roku od jednog minuta.

### Česti problemi

| Simptom | Uzrok |
|---|---|
| Saobraćaj se vidi, ali autor je prazan | `pulseMeta` se postavlja posle SDK-a, ili nedostaje na nekom šablonu |
| Isti autor se pojavljuje dvaput | slug nije konzistentan (razmak, veliko slovo, dijakritika) |
| Prosečno vreme je apsurdno visoko | live blog nema `contentType: "live-blog"` |
| Nema heatmape | korisnici nisu dali consent, ili tekst ima manje od 500 pregleda |
| Pročitanost je 0% | nedostaje `wordCount` |

---

## 7. Lansiranje

Preporučeni redosled (sekcija 14, Faza 6):

1. **10% saobraćaja** — SDK se učitava samo za deo korisnika; uporediti ukupne brojeve
   sa GA4 (razlika do 10% je normalna: Pulse filtrira botove agresivnije).
2. **50%** — proveriti `pulse_queue_depth` tokom prve utakmice.
3. **100%** — GA4 ostaje da radi paralelno prvih par meseci radi poređenja.

Pri svakoj fazi pratite Grafana dashboard „Pulse — pipeline".
