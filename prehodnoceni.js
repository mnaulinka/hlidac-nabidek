// prehodnoceni.js – znovu ohodnotí nabídky podle aktuálního kriteria.md BEZ nového scrapování.
//
// Použití:
//   node prehodnoceni.js bundy:ID_BĚHU merino:ID_BĚHU
// ID běhu (runId) je vidět ve výpisu Apify při předchozím spuštění hlidac.js.
// Skript jen PŘEČTE už existující data těchto běhů (nespouští actor, neplatí se za nové scrapování).
// Výsledky uloží do results-nova-kriteria.json, původní results.json zůstane nedotčený.

const fs = require("fs");
const path = require("path");
const h = require("./hlidac.js");

const OUTPUT_FILE = path.join(__dirname, "results.json");

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) throw new Error("Zadej běhy ve tvaru kategorie:runId, např. bundy:abc123 merino:def456");

  const { apify, claude } = h.createClients();
  const criteria = fs.readFileSync(h.CRITERIA_FILE, "utf8");
  if (fs.existsSync(OUTPUT_FILE)) {
    throw new Error("results.json už existuje, nechci ho přepsat. Přejmenuj ho nebo smaž.");
  }
  const results = [];

  for (const arg of args) {
    const [category, runId] = arg.split(":");
    console.log(`\n=== ${category} (běh ${runId}) ===`);
    const run = await apify.run(runId).get();
    if (!run) throw new Error(`Běh ${runId} nebyl nalezen.`);
    const { items } = await apify.dataset(run.defaultDatasetId).listItems();
    h.saveRawItems(category, items);
    console.log(`Načteno ${items.length} nabídek z existujícího běhu.`);

    for (const item of items) {
      const reason = h.prefilterReason(item, category);
      if (reason) {
        console.log(`- ${item.id}: vyřazeno předem (${reason})`);
        continue;
      }
      try {
        const record = await h.evaluate(claude, criteria, item, category);
        results.push(record);
        h.writeJson(OUTPUT_FILE, results);
        const zmena = record.navrzeny_verdikt !== record.verdikt ? ` (Claude navrhl ${record.navrzeny_verdikt}, kód snížil)` : "";
        console.log(`- ${item.id}: ${record.verdikt}${zmena} – ${item.title}`);
      } catch (err) {
        console.error(`- ${item.id}: chyba při hodnocení (${err.message})`);
      }
    }
  }
  console.log(`\nHotovo. Uloženo do ${path.basename(OUTPUT_FILE)}`);
}

main().catch((err) => {
  console.error("CHYBA:", err.message);
  process.exit(1);
});
