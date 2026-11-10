// test-modelu.js – test stability a srovnání modelů (bez Apify).
// Ohodnotí všech 10 nabídek z raw-items.json 2× modelem Haiku a 2× modelem Sonnet.
// Každý běh se uloží do zvláštního souboru results-test-<model>-<číslo>.json
// a na konci se uloží souhrn s náklady do test-modelu-souhrn.json.
//
// Spuštění: node test-modelu.js

const fs = require("fs");
const path = require("path");
const h = require("../hlidac.js");

// Ceny za 1 milion tokenů (USD), zdroj: ceník Anthropic. Haiku 5.5 platí pro prompty do 100 000 tokenů.
const MODELS = [
  { key: "haiku", id: "claude-haiku-5-5", inputPerM: 0.1, outputPerM: 0.5 },
  { key: "sonnet", id: "claude-sonnet-5-5", inputPerM: 2.0, outputPerM: 10.0 },
];
const RUNS = 2;

async function runJob(claude, criteria, rawItems, model, runNo) {
  const file = path.join(__dirname, `results-test-${model.key}-${runNo}.json`);
  const results = [];
  const errors = [];
  for (const { kategorie, item } of rawItems) {
    const reason = h.prefilterReason(item, kategorie);
    if (reason) continue; // všech 10 prošlo předvyřazením i dřív
    try {
      const record = await h.evaluate(claude, criteria, item, kategorie, { model: model.id });
      results.push(record);
      h.writeJson(file, results);
      console.log(`[${model.key} ${runNo}] ${item.id}: ${record.verdikt}${record.navrzeny_verdikt !== record.verdikt ? ` (navrhl ${record.navrzeny_verdikt})` : ""}`);
    } catch (err) {
      errors.push({ id: String(item.id), chyba: err.message });
      console.error(`[${model.key} ${runNo}] ${item.id}: CHYBA ${err.message}`);
    }
  }
  const tokens = results.reduce(
    (acc, r) => ({
      input: acc.input + r.pouziti.input_tokens,
      output: acc.output + r.pouziti.output_tokens,
      pokusu: acc.pokusu + r.pouziti.pokusu,
    }),
    { input: 0, output: 0, pokusu: 0 }
  );
  const costUsd = (tokens.input * model.inputPerM + tokens.output * model.outputPerM) / 1e6;
  return { model: model.id, key: model.key, beh: runNo, soubor: path.basename(file), hodnoceno: results.length, chyby: errors, ...tokens, naklady_usd: costUsd };
}

async function main() {
  const { claude } = h.createClients();
  const criteria = fs.readFileSync(h.CRITERIA_FILE, "utf8");
  const raw = h.readJson(h.RAW_FILE, {});
  const rawItems = Object.values(raw);
  console.log(`Nabídek k hodnocení: ${rawItems.length}`);

  // 4 běhy (2× Haiku, 2× Sonnet) jedou souběžně; uvnitř každého běhu se nabídky hodnotí po jedné.
  const jobs = [];
  for (const model of MODELS) for (let n = 1; n <= RUNS; n++) jobs.push(runJob(claude, criteria, rawItems, model, n));
  const summary = await Promise.all(jobs);

  h.writeJson(path.join(__dirname, "test-modelu-souhrn.json"), summary);
  console.log("\n=== Souhrn nákladů ===");
  for (const s of summary) {
    console.log(`${s.key} ${s.beh}: ${s.hodnoceno} nabídek, vstup ${s.input} tok., výstup ${s.output} tok., ${s.pokusu} volání, $${s.naklady_usd.toFixed(4)}${s.chyby.length ? `, chyb: ${s.chyby.length}` : ""}`);
  }
}

main().catch((err) => {
  console.error("CHYBA:", err.message);
  process.exit(1);
});
