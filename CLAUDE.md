# CLAUDE.md – Hlídač nabídek

> Tento soubor je **veřejný** (veřejný GitHub repozitář). Nepiš sem nikdy API klíče, hodnoty ze Secrets, e-maily
> ani jiné osobní údaje. Pokyny pro Clauda k hodnocení nabídek jsou v [kriteria.md](kriteria.md), ne tady.

## Jak se mnou pracovat

- Uživatelka je **začátečnice**: zná HTML a CSS, žádný programovací jazyk. Vysvětluj **každý krok** srozumitelně
  a česky, nepředpokládej znalost příkazové řádky ani Gitu.
- **Před instalací čehokoli se zeptej.** Před psaním kódu u větší změny **napiš plán a počkej na souhlas**.
- Nastavení na webu GitHubu klikne uživatelka sama; provedeš ji krok za krokem.
- Kód piš tak, aby mu rozuměla a mohla ho sama upravovat: komentáře česky, jednoduché konstrukce, žádné frameworky
  (stránka je jen HTML + CSS + trochu JavaScriptu).
- Prostředí: Windows, příkazy spouštěj přes **PowerShell**. Přihlášení k GitHubu je přes prohlížeč (HTTPS),
  ne SSH. Commity v tomto repozitáři jdou pod GitHub „noreply“ identitou (nastaveno lokálně v repu), nikdy pod
  osobním e-mailem.
- Před `git push` vždy nejdřív `git pull` (stav po běhu commituje do `main` GitHub Actions).
- **GitHub CLI (`gh`)** je nainstalovaný lokálně (přes winget) a přihlášený přes prohlížeč. Přes něj lze číst stav a logy
  běhů (`gh run list`, `gh run view --log`) a ručně spouštět workflow (`gh workflow run hlidac.yml --ref main`).
  Před každou akcí na GitHubu napiš uživatelce, co děláš (uživatelka si to výslovně přeje). Po instalaci může být
  potřeba nový terminál, aby `gh` byl v PATH; jinak ho volej celou cestou.

## Co projekt dělá

Osobní hlídač nabídek na Vintedu. Stáhne nabídky z uložených hledání, předem vyřadí nevyhovující, zbylé nechá
ohodnotit Claudem podle `kriteria.md`, pevná pravidla vynutí kód a výsledek zobrazí v přehledné webové stránce.
Spouští se automaticky každé ráno přes GitHub Actions.

Postup jednoho běhu (`node hlidac.js`):

1. Úklid: smaže z `results.json` a `raw-items.json` záznamy starší než `MAX_AGE_DAYS` (7 dní).
2. Pro každý řádek `searches.txt` (`kategorie;URL`, kategorie `bundy`, `merino` a `upozornit`) spustí Apify actor
   `epicscrapers/vinted-search-scraper` (země `cz`, max 5 položek na hledání, `includeDetails` zapnuto).
3. Přeskočí nabídky, které už jsou v `seen.json`.
4. Předem vyřadí: velikost jinou než L / 40, stav horší než „Velmi dobrý“ (podle `status_id`, ne podle textu –
   Apify posílá popisky francouzsky), u bund jinou značku než Haglöfs a Salewa.
5. Zbylé nabídky pošle do Claude API (popis, max 5 fotek, pokyny z `kriteria.md`) jako structured output (JSON podle schématu).
6. `pravidla.js` zkontroluje navržený verdikt a případně ho **sníží** (nikdy nezvýší); poměr ceny počítá kód.
7. Uloží do `results.json`, vygeneruje `index.html`, zapíše `last-run.json`.
8. Pošle upozornění přes ntfy (`ntfy.js`): o nových nabídkách z kategorie `upozornit` a o nových s verdiktem KOUPIT
   (jedna nabídka = jedna zpráva, víc = jedna souhrnná).

Kategorie **`upozornit`** (např. knihy): nabídky se NEHODNOTÍ Claudem a neplatí pro ně předvyřazení; ukládají se
zjednodušeně (název, cena, odkaz, fotka) a stránka je ukazuje nahoře v sekci „Objevilo se!“ (všechny ze 7 dní, nové
se štítkem). V `searches.txt` jde za `upozornit` dvojtečka a štítek (`upozornit:Knihy;URL`): podle něj se nabídky
seskupí na stránce (nadpisy skupin, „Ostatní“ dole) i v souhrnné ntfy zprávě; řádek bez štítku jde do „Ostatní“.
Karty v „Objevilo se!“ jdou skrýt stejně jako ostatní (tlačítko „Skrýt“, ukládá se v prohlížeči); prázdná skupina
i celá sekce se při skrytí všeho schová.

## Soubory

| Soubor | K čemu je |
|---|---|
| `hlidac.js` | hlavní skript; nahoře nastavení (modely, počet položek, `MAX_AGE_DAYS`, schéma odpovědi) |
| `pravidla.js` | pevná pravidla vynucovaná kódem (stáří, cena, složení merina, typ izolace) |
| `ntfy.js` | upozornění přes ntfy; kanál z proměnné `NTFY_TOPIC` (Secrets / `.env`), `node ntfy.js --test` pošle zkoušku |
| `stranka.js` + `sablona.html` | generátor přehledu; **vzhled se upravuje jen v `sablona.html`** (CSS proměnné nahoře) |
| `index.html` | vygenerovaná stránka, **needitovat**, je v `.gitignore`, na web jde jako artefakt |
| `ikony/`, `manifest.webmanifest` | ikona stránky (lupa na #007782): SVG + PNG 32/180/192/512 a manifest pro „Přidat na plochu“; ikony vyrobí `node ikony/vytvor-ikony.js` (barva a tvar nahoře ve skriptu), na web je nahrává workflow |
| `kriteria.md` | pokyny pro Clauda (oddíl 1 = struktura výstupu) |
| `searches.txt` | odkazy na hledání |
| `seen.json`, `results.json`, `last-run.json` | stav mezi běhy (commitují se zpět do repozitáře) |
| `raw-items.json` | surová data z Apify, jen lokálně (`.gitignore`) |
| `prehodnoceni.js` | znovu ohodnotí nabídky z už proběhlých Apify běhů bez nového stahování (`node prehodnoceni.js bundy:ID merino:ID`) |
| `test/` | testovací skripty (`test-modelu.js`, `stranka-test.js`, `uklid-test.js`, `upozornit-test.js`); jejich výstupy jsou v `.gitignore` |
| `.github/workflows/hlidac.yml` | plánované spouštění a zveřejnění |
| `.env` / `.env.example` | klíče lokálně (`.env` se nikdy nenahrává) / prázdná šablona |

Lokálně: `node hlidac.js` (celý běh, stojí peníze), `node stranka.js` (jen přegeneruje `index.html`, zdarma).

## Workflow a GitHub Pages

- `hlidac.yml` má osm plánovaných termínů denně v pražském čase (cron s polem `timezone: "Europe/Prague"`): noční
  22:17, 00:17, 02:17, 04:17 a ranní 6:17, 7:17, 8:17, 9:17. **Důvod:** GitHub plánované běhy tohoto repozitáře
  posouvá o mnoho hodin (11.–13. 11. 2026 vznikly až odpoledne, někdy vůbec), proto jsou termíny i přes noc – i se
  zpožděním má být běh hotový ráno. První krok čte `last-run.json`: pokud v posledních **16 hodinách** proběhl
  úspěšný běh (`uspech: true`), plánovaný běh skončí („přeskakuji“). Ruční spuštění (`workflow_dispatch`) se provede
  vždy. Zda noční termíny opravdu pomáhají a zda GitHub `timezone` respektuje, se teprve ověřuje (záloha: úloha
  v aplikaci Claude, která spustí `gh workflow run`, když ten den žádný běh neproběhl – zatím nenastaveno).
- Klíče se berou z **GitHub Secrets** `APIFY_TOKEN`, `ANTHROPIC_API_KEY` a `NTFY_TOPIC` (kanál pro upozornění; když
  chybí, upozornění se jen přeskočí a běh nespadne; v kódu `createClients()` čte proměnné
  prostředí a pak `.env`).
- Po běhu workflow commitne `seen.json`, `results.json` a `last-run.json` zpět do `main` (i po chybném běhu).
- Pages: zdroj „GitHub Actions“; nahrává se **jen `index.html`, `manifest.webmanifest` a obrázky ikony ze složky `ikony/`**
  (`_site/`), nic jiného z repozitáře na web nejde.
  Prostředí `github-pages` musí mít povolenou větev `main` (Settings → Environments).
- Web: https://mnaulinka.github.io/hlidac-nabidek/

## Důležitá rozhodnutí

- **Modely podle kategorie:** bundy hodnotí Sonnet (`claude-sonnet-5-5`), merino Haiku (`claude-haiku-5-5`).
  Nastavuje se na jednom místě, `MODEL_BY_CATEGORY` v `hlidac.js`. Test 2× Haiku / 2× Sonnet: Sonnet je asi 15× dražší,
  verdikty obou jsou stabilní zhruba u 9 z 10 nabídek, odhady stáří a ceny se mezi běhy hodně liší.
- **Záložní model (`fallbacks`)** je zapnutý u Sonnetu (`FALLBACK_MODELS`). Zatím se nikdy nespustil.
- **Teplotu nastavit nejde:** Haiku 5.5 a Sonnet 5.5 parametr `temperature` odmítají (chyba 400). Používá se pevné `effort: medium`.
- **Pevná pravidla jsou v kódu (`pravidla.js`), ne v pokynech:** Claude vrací fakta + navržený verdikt, kód ho jen
  snižuje a ke každé změně uloží důvod (`upraveno_kodem`). Claude nepočítá poměr ceny a v důvodech necituje ceny.
  Odhad ceny nové věci je vždy rozmezí v Kč (`null` není povolen).
- **Nabídky starší než 7 dní** (konstanta `MAX_AGE_DAYS`) se při každém běhu mažou z `results.json` a `raw-items.json`
  a stránka je neukazuje. Stáří se počítá od chvíle, kdy je hlídač ohodnotil.
- **`seen.json` se nikdy nemaže**, aby se staré nabídky, které se ještě objeví v Apify, znovu nehodnotily.
- **Repozitář je veřejný** (kvůli bezplatným GitHub Pages) a uživatelka souhlasila s veřejným `kriteria.md`,
  `searches.txt` i výsledky. Tajemství patří jen do Secrets a `.env`. Název kanálu pro ntfy je také jen v Secrets a `.env`.
- Stránka je navržená především pro mobil; hlavní barva `#007782`, žádné logo ani název Vinted.

## Co zbývá

1. **Ověřit plánované běhy:** zjistit z `gh run list`, v kolik hodin skutečně vznikají plánované běhy po přidání nočních
   termínů (od 13. 11. 2026) a zda je data hotová ráno. Zpoždění GitHubu bylo dosud hodiny až celý den. Když noc
   nepomůže, nastavit záložní spuštění z počítače (úloha v aplikaci Claude, jen při otevřené aplikaci).
2. **Tlačítko „Kopírovat pro Clauda“** na kartě v `sablona.html` (zkopíruje data nabídky k vložení do chatu s Claudem).
3. Dostat stránku pohodlně do telefonu (ověřit zobrazení na skutečném mobilu a trvalé ukládání „Skrýt“ v běžném
   prohlížeči; ukládá se zvlášť v každém prohlížeči a zařízení).
4. Nabídky `upozornit` se nijak nefiltrují: co vrátí hledání na Vintedu, to se ukáže (např. cizojazyčné inzeráty).
   Když to bude rušit, zpřesnit odkaz hledání (velikost, stav) ve Vintedu.

## Hotovo (listopad 2026)

- **Plánování workflow:** osm spuštění denně (přes noc i ráno) s `timezone: "Europe/Prague"` a kontrolou podle
  `last-run.json` (úspěšný běh v posledních 16 hodinách → plánovaný běh se přeskočí); zpožděný běh se nezahodí
  a dva běhy za den se neprovedou.
- **Kategorie `upozornit`** se štítky (`upozornit:Štítek;URL`), sekce „Objevilo se!“, tlačítko „Skrýt“ i u těchto
  karet, upozornění přes ntfy (funguje, ověřeno ostrým během i na telefonu uživatelky).
- **Ikona stránky** (lupa na #007782): SVG, PNG 32/180/192/512 a `manifest.webmanifest` ve složce `ikony/`, odkazy
  jsou v `<head>` šablony, workflow je nahrává na web. Na živém webu ověřeno (všechny soubory vrací HTTP 200).
  Na skutečném telefonu („Přidat na plochu“) a v záložce prohlížeče zatím neověřeno; prohlížeče si favicon
  drží v mezipaměti, takže se může ukazovat stará.

## Známé drobnosti

- GitHub hlásí, že akce `checkout@v4`, `setup-node@v4` a `upload-artifact@v4` běží přes Node 20 (nově vynuceno Node 24);
  nevadí, později zvýšit verze akcí. Podobně hlásí přesun `ubuntu-latest` na novější systém.
- **Apify:** uživatelka upozornila, že od 13. 11. 2026 jsou relevantní náklady za Apify – před dalším spouštěním ověřit
  stav kreditu a tarifu v konzoli Apify (jeden běh dvou hledání je zhruba pár centů) a nastavit měsíční limity
  v Apify i Anthropic.
- Plánované běhy GitHub po 60 dnech bez aktivity v repozitáři vypne (pošle upozornění e-mailem).
- Lokální `raw-items.json` není v repozitáři, takže `prehodnoceni.js` v Actions nefunguje; je to nástroj pro lokální práci.
- `results-v1.json` a další starší výsledky jsou jen lokálně (`.gitignore`).
