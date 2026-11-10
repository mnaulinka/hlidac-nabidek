// Vygeneruje test/index-test.html z upravených kopií dat, aby šlo vyzkoušet stránku
// s novými nabídkami, skupinou KOUPIT, škodlivým textem v názvu a nabídkou bez fotky.
// Skutečné results.json ani index.html se nemění.
const path = require("path");
const h = require("../hlidac.js");
const { generatePage } = require("../stranka.js");

const results = JSON.parse(JSON.stringify(h.readJson(path.join(__dirname, "..", "results.json"), [])));
const RUN = "TEST-BEH";

// Prvních 5 nabídek označíme jako nové z posledního běhu
results.slice(0, 5).forEach((r) => (r.beh_id = RUN));
// Jednu bundu povýšíme na KOUPIT (bez snížení) a druhé dáme zlý název a odebereme fotku
const bunda = results.find((r) => r.kategorie === "bundy");
bunda.verdikt = "KOUPIT";
bunda.navrzeny_verdikt = "KOUPIT";
bunda.upraveno_kodem = [];
results[1].nazev = 'Test </script><b>tučně</b> & "uvozovky" $& $1';
results[1].foto = null;
// Jedna stará nabídka (8 dní) se na stránce nesmí objevit
const stara = JSON.parse(JSON.stringify(results[9]));
stara.id = "stara-8-dni";
stara.nazev = "TATO NABÍDKA SE NESMÍ ZOBRAZIT (8 dní stará)";
stara.hodnoceno = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
results.push(stara);

const count = generatePage({
  results,
  lastRun: { id: RUN, zacatek: new Date().toISOString(), konec: new Date().toISOString(), nalezeno: 10, nove: 5 },
  maxAgeDays: h.MAX_AGE_DAYS,
  templateFile: path.join(__dirname, "..", "sablona.html"),
  outFile: path.join(__dirname, "index-test.html"),
});
console.log(`test/index-test.html: ${count} nabídek (11 na vstupu, 1 stará se má vyřadit)`);
