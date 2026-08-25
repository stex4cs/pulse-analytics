# Kako čitati Pulse izveštaje

Za urednike. Cilj: da brojevi vode do odluke, a ne do pogrešnog zaključka.

---

## Metrike koje se lako pogrešno protumače

### Pročitanost (read completion) — najvažniji broj

Procenat čitalaca koji su stigli do **75%+ teksta** *i* proveli vreme **srazmerno
njegovoj dužini** (računato po 200 reči u minuti).

Zašto to nije isto što i „vreme na stranici": neko može ostaviti tab otvoren sat
vremena i ništa ne pročitati. Pulse ne broji vreme dok je tab u pozadini, i traži
da je čitalac zaista stigao do kraja.

**Šta je normalno:** 15–35% za vest, više za kolumnu, znatno niže za tekstove
sa Discover-a.

**Kako se koristi:** tekst sa 50.000 pregleda i 8% pročitanosti i tekst sa 12.000
pregleda i 40% pročitanosti nisu isti uspeh. Prvi je dobar naslov, drugi je dobar tekst.
Oba su korisna — ali za različite stvari.

### Bounce rate — grubo merilo, koristite ga oprezno

Sesija sa jednom stranicom. Za news portal to je često *normalno* ponašanje: čovek
dođe sa Facebook-a, pročita vest, ode. Nije neuspeh.

**Koristite ga samo za poređenje kanala međusobno**, nikad kao ocenu teksta.
Za tekst gledajte pročitanost i levak skrola.

### Prosek po članku — pošten prema autorima

Autor koji objavi 5 tekstova sa po 20.000 pregleda i autor koji objavi 50 tekstova
sa po 3.000 imaju sličan ukupan zbir, ali vrlo različit učinak.

Sortirajte tabelu autora po **proseku po članku** kad procenjujete kvalitet, a po
**ukupnim pregledima** kad gledate doprinos saobraćaju. Oba su tačna, mere različite stvari.

### Jedinstveni posetioci se ne sabiraju

Ako ponedeljak ima 40.000 i utorak 45.000 jedinstvenih, nedelja **nema** 85.000 —
mnogi su isti ljudi. Pulse ovo računa ispravno za svaki period koji izaberete;
nemojte sabirati brojeve iz različitih redova ručno.

---

## Kanali

### Google Discover — izdvojen s razlogom

Ponaša se potpuno drugačije od pretrage: dolazi **u talasima**, sesije su kratke,
bounce visok. Zato ima svoj grafik i ne meša se sa organskom pretragom.

**Kako se koristi:** Discover skok je prilika (tema je pogođena), ali ti čitaoci se
retko vraćaju. Ako je udeo Discover-a visok a ukupni jedinstveni posetioci ne rastu,
saobraćaj je pozajmljen, ne izgrađen.

### „Direktan" je delom lažan

Uključuje dolaske iz Viber-a, WhatsApp-a, native aplikacije, email klijenata, i
slučajeve gde se referrer izgubi. To **nije** samo „ljudi koji kucaju adresu".

**Šta uraditi:** tagujte newsletter i app deep linkove UTM parametrima
(`?utm_source=newsletter&utm_medium=email&utm_campaign=...`). Svaki tagovani link
izlazi iz „direct" korpe u svoj kanal i broj postaje upotrebljiv.

### Kanal × kategorija

Presek na ekranu **Kategorije** pokazuje odakle koja rubrika živi. Tipično:
NBA vesti sa Google-a, Superliga sa Facebook-a.

**Kako se koristi:** rubrika koja zavisi od jednog kanala je krhka — promena
Facebook algoritma je ruši preko noći. Rubrika sa razvučenim izvorima je stabilna.

---

## Tagovi i trending

**Trending skor** = koliko je tag skočio u poslednjem satu u odnosu na svoj
dvadesetčetvoročasovni prosek, prigušeno logaritmom.

Logaritam je tu da tag sa 5 → 20 pregleda ne nadmaši tag sa 5.000 → 12.000.
Bez njega bi lista trending tagova bila puna statističkog šuma.

**Kako se koristi:** visok skor znači „ovo se upravo dešava" — vredi objaviti prateći
tekst dok traje talas. Ukupni pregledi po tagu za mesec dana su drugo pitanje:
oni kažu o čemu se **dugoročno** isplati pisati.

---

## A/B testovi naslova

Pulse **neće** proglasiti pobednika dok ne bude ispunjeno oboje:

- **95% statističke konfidencije**, i
- **minimum 1.000 prikaza po varijanti**

Dok to nije ispunjeno, piše „Još nema dovoljno podataka" i navodi koliko prikaza
nedostaje.

**Ovo nije opreznost radi opreznosti.** Sa 200 prikaza po varijanti, razlika od 30% u
CTR-u je potpuno očekivana slučajnost. Odluka doneta na tom uzorku je pogađanje sa
brojevima kao ukrasom — gore od odluke bez ikakvog testa, jer nosi lažno samopouzdanje.

Kad pobednik postoji, dugme **Promoviši** prebacuje sav saobraćaj na tu varijantu.

---

## Spike alerti

Okidaju se kad pregledi u minutu pređu **3× prosek za taj dan u nedelji i to doba
dana** (baseline iz poslednje četiri nedelje — ne poredi se nedeljno veče sa
utorkom pre podne).

Uz alert stoji **šta ga vuče** — konkretan tekst ili rubrika.

**Kako se koristi tokom utakmice:** alert znači da nešto radi upravo sada. Podignite
taj tekst na naslovnu, objavite nastavak, pošaljite push. Prozor je 15–30 minuta.

---

## Levak skrola (na ekranu članka)

Pokazuje koliko čitalaca je stiglo do 25 / 50 / 75 / 100% teksta.

**Kako se čita:** veliki pad između 25% i 50% znači da tekst gubi ljude u prvoj
trećini — obično uvod koji ne ispunjava obećanje naslova. Ravnomeran pad je normalan.

Uparite ga sa pročitanošću: visok skrol a niska pročitanost znači da su ljudi
*skrolovali* do dna, ne da su *pročitali*.

---

## „Kako se poredi" (percentil)

Na ekranu članka: gde je ovaj tekst u odnosu na sve tekstove iste rubrike
u poslednjih 90 dana.

75. percentil znači da je bolji od tri četvrtine rubrike. Ovo je pošteniji sud od
apsolutnog broja, jer 8.000 pregleda u Superligi i 8.000 u odbojci nisu isti uspeh.

---

## Šta Pulse namerno ne meri

Da ne bi bilo nesporazuma o obimu:

- prihod i ad performanse (poseban sistem)
- personalizaciju i preporuke sadržaja
- video dublje od play/progress — YouTube iframe se ne meri
- povezivanje istog čitaoca preko više uređaja
- predikciju saobraćaja

GA4 ostaje da radi paralelno prvih par meseci radi poređenja. Razlika u ukupnim
brojevima do 10% je očekivana — Pulse agresivnije filtrira botove i drugačije
broji sesije.
