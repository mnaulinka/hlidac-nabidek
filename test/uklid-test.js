// Test úklidu starých dat na KOPIÍCH souborů v dočasné složce (skutečná data se nemění).
// Ověřuje: staré hodnocení i surový záznam (starší než MAX_AGE_DAYS) zmizí, čerstvé zůstanou,
// seen.json se nedotkne vůbec.
const fs = require("fs");
const os = require("os");
const path = require("path");
const h = require("../hlidac.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uklid-"));
const DAY = 24 * 3600 * 1000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();

const resultsFile = path.join(tmp, "results.json");
const rawFile = path.join(tmp, "raw-items.json");
const seenFile = path.join(tmp, "seen.json");
h.writeJson(resultsFile, [
  { id: "cerstva", hodnoceno: iso(1) },
  { id: "6-dni", hodnoceno: iso(6) },
  { id: "8-dni", hodnoceno: iso(8) },
]);
h.writeJson(rawFile, {
  cerstva: { kategorie: "bundy", ulozeno: iso(1), item: {} },
  "8-dni": { kategorie: "bundy", ulozeno: iso(8), item: {} },
  "bez-data-ale-ma-hodnoceni-8-dni": { kategorie: "bundy", item: {} }, // ulozeno chybí -> bez hodnocení se počítá od dneška
  "6-dni": { kategorie: "bundy", item: {} }, // ulozeno chybí, hodnocení 6 dní -> zůstane
});
h.writeJson(seenFile, ["cerstva", "6-dni", "8-dni", "uplne-stare"]);
const seenPred = fs.readFileSync(seenFile, "utf8");

h.cleanOldData(resultsFile, rawFile);

const results = h.readJson(resultsFile, []).map((r) => r.id);
const raw = Object.keys(h.readJson(rawFile, {}));
const checks = [
  ["results: zůstaly čerstvá a 6 dní", JSON.stringify(results) === JSON.stringify(["cerstva", "6-dni"])],
  ["raw: 8 dní smazáno, ostatní zůstaly", !raw.includes("8-dni") && raw.includes("cerstva") && raw.includes("6-dni") && raw.includes("bez-data-ale-ma-hodnoceni-8-dni")],
  ["seen.json se nezměnil", fs.readFileSync(seenFile, "utf8") === seenPred],
];
checks.forEach(([n, ok]) => console.log(`${ok ? "OK   " : "CHYBA"} ${n}`));
console.log(`(MAX_AGE_DAYS = ${h.MAX_AGE_DAYS}; results po úklidu: ${results.join(", ")}; raw: ${raw.join(", ")})`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
