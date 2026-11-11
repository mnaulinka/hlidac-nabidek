// stranka.js – vygeneruje index.html (přehled nabídek) ze šablony sablona.html.
//
// Data z results.json se vloží přímo do stránky, takže se index.html dá otevřít dvojklikem.
// Volá se automaticky na konci hlidac.js. Samostatně (bez Apify a bez Clauda, zdarma):
//     node stranka.js
// To se hodí, když upravuješ vzhled v sablona.html a chceš si stránku jen přegenerovat.

const fs = require("fs");
const path = require("path");

const DAY_MS = 24 * 60 * 60 * 1000;
const PLACEHOLDER = "/*DATA*/";

// results: pole hodnocení, lastRun: údaje o posledním běhu (nebo null), maxAgeDays: stáří v dnech
function generatePage({ results, lastRun, maxAgeDays, templateFile, outFile }) {
  const template = fs.readFileSync(templateFile, "utf8");
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`V šabloně chybí řádek ${PLACEHOLDER}, nemám kam vložit data.`);
  }

  // Na stránce jen nabídky ne starší než maxAgeDays (podle toho, kdy je hlídač ohodnotil)
  const limit = Date.now() - maxAgeDays * DAY_MS;
  const recent = results.filter((r) => Date.parse(r.hodnoceno) >= limit);
  // Nabídky z kategorie "upozornit" nejsou hodnocené, mají vlastní sekci „Objevilo se!“
  const offers = recent.filter((r) => r.kategorie !== "upozornit");
  const alerts = recent.filter((r) => r.kategorie === "upozornit");

  const data = {
    vytvoreno: new Date().toISOString(),
    maxDni: maxAgeDays,
    posledniBeh: lastRun || null,
    nabidky: offers,
    objevilo: alerts,
  };

  // JSON vložený do <script>: každý znak "menší než" nahradíme zápisem "zpětné lomítko + u003c", aby text v datech nemohl předčasně ukončit <script>.
  const json = JSON.stringify(data)
    .split("<").join("\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
  // split/join místo replace: v datech se může objevit "$", který by replace vykládal jako speciální znak
  fs.writeFileSync(outFile, template.split(PLACEHOLDER).join(json), "utf8");
  return recent.length;
}

module.exports = { generatePage };

// node stranka.js -> přegeneruje index.html z aktuálních dat
if (require.main === module) {
  try {
    const count = require("./hlidac.js").regeneratePage();
    console.log(`Hotovo: index.html (${count} nabídek).`);
  } catch (err) {
    console.error("CHYBA:", err.message);
    process.exit(1);
  }
}
