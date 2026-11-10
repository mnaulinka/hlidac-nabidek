# Hlídač nabídek

Osobní skript, který hlídá nabídky na Vintedu: stáhne nové nabídky z uložených hledání, předem vyřadí nevyhovující
(velikost, stav, značka), zbylé nechá ohodnotit Claudem podle pokynů v [kriteria.md](kriteria.md), pevná pravidla
(stáří, cena, složení) vynutí kódem a výsledek zobrazí v přehledné stránce.

Spouští se automaticky každé ráno kolem 6:00 (Praha) přes GitHub Actions. Přehled se zveřejňuje přes GitHub Pages.

## Soubory

| Soubor | K čemu je |
|---|---|
| `hlidac.js` | hlavní skript (Apify → filtry → Claude → pravidla → results.json → index.html) |
| `pravidla.js` | pevná pravidla, která kód vynucuje (stáří, cena, složení) |
| `stranka.js`, `sablona.html` | generátor přehledu; vzhled se upravuje v `sablona.html` |
| `kriteria.md` | pokyny pro Clauda |
| `searches.txt` | odkazy na hledání (`kategorie;URL`) |
| `seen.json`, `results.json`, `last-run.json` | stav mezi běhy; po každém běhu je commitne GitHub Actions |
| `.github/workflows/hlidac.yml` | plánované spouštění |

## Spuštění u sebe na počítači

```bash
npm ci
cp .env.example .env      # a do .env doplnit APIFY_TOKEN a ANTHROPIC_API_KEY
node hlidac.js            # celý běh
node stranka.js           # jen přegenerovat index.html z uložených dat (zdarma)
```

Soubor `.env` je v `.gitignore` a nikdy se nenahrává. V GitHub Actions se klíče berou ze Secrets
(`APIFY_TOKEN`, `ANTHROPIC_API_KEY`).

Před lokálním během po nasazení na GitHub nejdřív `git pull`, ať se stav (`seen.json`, `results.json`) nerozejde.
