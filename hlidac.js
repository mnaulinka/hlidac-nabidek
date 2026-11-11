// hlidac.js – hlídač nabídek z Vinted (první část, spouští se ručně: node hlidac.js)
//
// Postup:
//   1) načte klíče z .env a hledání ze searches.txt
//   2) pro každé hledání spustí Apify actor a stáhne nabídky
//   3) přeskočí nabídky, které už viděl (seen.json)
//   4) předem vyřadí nevyhovující (velikost, stav, značka)
//   5) zbylé pošle do Claude API s pokyny z kriteria.md
//   6) poměr ceny dopočítá kód (Claude ho nepočítá)
//   7) výsledky uloží do results.json

const fs = require("fs");
const path = require("path");
const { ApifyClient } = require("apify-client");
const Anthropic = require("@anthropic-ai/sdk");
const { applyRules } = require("./pravidla.js");
const { generatePage } = require("./stranka.js");
const { buildNotification, sendNotification } = require("./ntfy.js");

// ---------- Nastavení (tady se dá snadno měnit) ----------
const ACTOR = "epicscrapers/vinted-search-scraper";
const MAX_ITEMS_PER_SEARCH = 5; // max nabídek na jedno hledání
const MAX_PHOTOS = 5; // max fotek poslaných Claudovi
// Který model hodnotí kterou kategorii – ZMĚNA MODELU SE DĚLÁ TADY (a jen tady).
const MODEL_BY_CATEGORY = {
  bundy: "claude-sonnet-5-5",
  merino: "claude-haiku-5-5",
};
const DEFAULT_MODEL = "claude-haiku-5-5"; // pro kategorii, která není v seznamu výše
// Modely, u kterých je zapnutý záložní model (server-side fallbacks): když model odmítne odpovědět
// z bezpečnostních důvodů, API stejný požadavek samo zopakuje na záložním modelu.
const FALLBACK_MODELS = ["claude-sonnet-5-5"];
// Ceny za 1 milion tokenů (USD) – jen pro výpis orientačních nákladů na konci běhu.
const PRICES = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0 },
};
// Kategorie, jejíž nabídky se NEHODNOTÍ Claudem a nepředvyřazují (např. knihy): jen se zobrazí na stránce
// v sekci „Objevilo se!“ a pošle se o nich upozornění přes ntfy.
const ALERT_CATEGORY = "upozornit";
const modelFor = (category) => MODEL_BY_CATEGORY[category] || DEFAULT_MODEL;
const EFFORT = "medium"; // hloubka přemýšlení (low / medium / high); teplotu modely Haiku 5.5 a Sonnet 5.5 nepřijímají
const ALLOWED_STATUS_IDS = [6, 1, 2]; // 6 = nové s visačkou, 1 = nové bez visačky, 2 = velmi dobrý
const ALLOWED_JACKET_BRANDS = ["haglofs", "salewa"]; // bez diakritiky, malými písmeny
// Jak dlouho (ve dnech) se nabídky drží v results.json a raw-items.json a zobrazují na stránce.
// Starší se při každém běhu smažou. seen.json se nemaže (staré nabídky se pak znovu nehodnotí).
const MAX_AGE_DAYS = 7;
const INSULATION_TYPES = ["péřová", "syntetická", "vlněná", "kombinovaná", "bez izolace", "nezjištěno"];

// ---------- Cesty k souborům ----------
const DIR = __dirname;
const SEARCHES_FILE = path.join(DIR, "searches.txt");
const CRITERIA_FILE = path.join(DIR, "kriteria.md");
const SEEN_FILE = path.join(DIR, "seen.json");
const RESULTS_FILE = path.join(DIR, "results.json");
const LAST_RUN_FILE = path.join(DIR, "last-run.json"); // údaje o posledním běhu (pro stránku)
const TEMPLATE_FILE = path.join(DIR, "sablona.html"); // šablona stránky (tu upravuješ)
const INDEX_FILE = path.join(DIR, "index.html"); // vygenerovaná stránka (needituj)
const RAW_FILE = path.join(DIR, "raw-items.json"); // surová data z Apify (aby šlo hodnotit znovu bez stahování)

// ---------- Pomocné funkce ----------

// Přečte JSON soubor; když neexistuje, vrátí výchozí hodnotu.
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// "Haglöfs" -> "haglofs" (odstraní diakritiku a velká písmena)
function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Vezme klíče z proměnných prostředí (tak je dodá GitHub Actions ze Secrets) a pokud je soubor .env,
// doplní je z něj (u tebe na počítači). Už nastavené proměnné prostředí se z .env nepřepisují.
function createClients() {
  const envFile = path.join(DIR, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  if (!process.env.APIFY_TOKEN || !process.env.ANTHROPIC_API_KEY) {
    throw new Error("Chybí APIFY_TOKEN nebo ANTHROPIC_API_KEY (doplň je do souboru .env, nebo je nastav v prostředí / GitHub Secrets).");
  }
  return {
    apify: new ApifyClient({ token: process.env.APIFY_TOKEN }),
    claude: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  };
}

// Řádky searches.txt: "kategorie;URL". U kategorie "upozornit" jde za názvem kategorie dvojtečka a štítek,
// podle kterého se nabídky na stránce a v upozornění seskupí: "upozornit:Knihy;URL".
function readSearches() {
  return fs
    .readFileSync(SEARCHES_FILE, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf(";");
      const head = line.slice(0, i);
      const j = head.indexOf(":");
      return {
        category: (j === -1 ? head : head.slice(0, j)).trim(),
        label: j === -1 ? "" : head.slice(j + 1).trim(), // štítek (může být prázdný)
        url: line.slice(i + 1).trim(),
      };
    });
}

// Je velikost L / 40? (Vinted ji píše jako "L / 40")
function isRightSize(item) {
  const size = normalize(item.size_title).replace(/\s+/g, "");
  return size === "l" || size === "l/40";
}

// Vrátí důvod vyřazení, nebo null, když nabídka projde.
function prefilterReason(item, category) {
  if (!isRightSize(item)) return `velikost "${item.size_title}"`;
  if (!ALLOWED_STATUS_IDS.includes(item.status_id)) return `stav status_id=${item.status_id}`;
  if (category === "bundy" && !ALLOWED_JACKET_BRANDS.includes(normalize(item.brand_title))) {
    return `značka "${item.brand_title}"`;
  }
  return null;
}

// Fotky mohou být seznam textů nebo objektů s polem url.
function getPhotoUrls(item) {
  const list = Array.isArray(item.photos) ? item.photos : [];
  const urls = list.map((p) => (typeof p === "string" ? p : p && (p.full_size_url || p.url))).filter(Boolean);
  if (urls.length === 0 && item.photo && item.photo.url) urls.push(item.photo.url);
  return urls.slice(0, MAX_PHOTOS);
}

// Uloží surová data nabídek (podle ID), aby šlo později hodnotit znovu bez Apify.
function saveRawItems(category, items) {
  const raw = readJson(RAW_FILE, {});
  for (const item of items) {
    const id = String(item.id);
    raw[id] = { kategorie: category, ulozeno: (raw[id] && raw[id].ulozeno) || new Date().toISOString(), item };
  }
  writeJson(RAW_FILE, raw);
}

// ---------- Poměr ceny (počítá kód, ne Claude) ----------
// Celková cena nabídky / dolní mez ceny nové a / horní mez ceny nové, v %.
// Pozor: při dolní mezi vychází poměr VYŠŠÍ (horší případ), při horní NIŽŠÍ (lepší případ).
function computePriceRatio(item, cenaNove) {
  const total = item.total_item_price ? Number(item.total_item_price.amount) : NaN;
  const currency = item.total_item_price && item.total_item_price.currency_code;
  if (!Number.isFinite(total) || currency !== "CZK") {
    return { poznamka: `Poměr nelze spočítat (celková cena: ${total}, měna: ${currency}).` };
  }
  const ratio = (limit) => (typeof limit === "number" && limit > 0 ? Math.round((total / limit) * 100) : null);
  const result = {
    cena_celkem_kc: total,
    pri_dolni_mezi_pct: ratio(cenaNove && cenaNove.od_kc),
    pri_horni_mezi_pct: ratio(cenaNove && cenaNove.do_kc),
  };
  if (result.pri_dolni_mezi_pct === null && result.pri_horni_mezi_pct === null) {
    result.poznamka = "Poměr nelze spočítat: Claude neuvedl odhad ceny nové věci.";
  }
  return result;
}

// ---------- Apify ----------
async function fetchItems(apify, search) {
  const run = await apify.actor(ACTOR).call({
    startUrls: [{ url: search.url }],
    country: "cz",
    maxProducts: MAX_ITEMS_PER_SEARCH,
    includeDetails: true,
  });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  return items;
}

// ---------- Claude ----------
// Odpověď Clauda vynucujeme přes structured outputs (output_config.format = json_schema):
// API vždy vrátí platný JSON přesně podle tohoto schématu.
// Pomocné funkce: objekt, kde jsou všechna pole povinná a nic navíc (požadavek structured outputs).
const obj = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const nullableNumber = (description) => ({ anyOf: [{ type: "number" }, { type: "null" }], description });
const CONFIDENCE = ["jisté", "pravděpodobné", "nejisté"];

// Schéma odpovědi (oddíl 1 v kriteria.md). U bund přibývá typ izolace jako první údaj, u merina podíl přírodních vláken.
function buildSchema(category) {
  const podrobnosti = {};
  if (category === "bundy") {
    podrobnosti.typ_izolace = { type: "string", enum: INSULATION_TYPES, description: "Typ izolace podle kritérií (oddíl 3.1)." };
  }
  podrobnosti.stari_modelu = obj({
    odhad: { type: "string", description: "Rok nebo rozmezí slovy, nebo 'nelze určit'." },
    od_let: nullableNumber("Odhad stáří v letech k dnešku – nejmladší možné (číslo), nebo null když nelze odhadnout."),
    do_let: nullableNumber("Odhad stáří v letech k dnešku – nejstarší možné (číslo), nebo null když nelze odhadnout."),
    jistota: { type: "string", enum: CONFIDENCE },
    z_ceho: { type: "string", description: "Z čeho to vyvozuješ." },
  });
  podrobnosti.cena_nove = obj({
    od_kc: { type: "number", description: "Dolní mez odhadu ceny nové věci v Kč (kladné číslo). VŽDY vyplň, i když je odhad nejistý." },
    do_kc: { type: "number", description: "Horní mez odhadu ceny nové věci v Kč (kladné číslo, nejméně jako dolní mez). VŽDY vyplň, i když je odhad nejistý (pak široké rozmezí a jistota 'nejisté')." },
    jistota: { type: "string", enum: CONFIDENCE },
    z_ceho: { type: "string", description: "Z čeho odhad vychází. Poměr ceny NEPOČÍTEJ, dopočítá ho kód." },
  });
  podrobnosti.izolace_material = {
    type: "string",
    description: "Údaje ze štítku a popisu (izolace/materiál, plnivost, gramáž, složení). Jen uvést, nehodnotit. Co chybí, napiš jako 'neuvedeno'.",
  };
  podrobnosti.stav_podle_fotek = { type: "string", description: "Stav podle fotek; zmiň rozpor s údajem prodávajícího." };
  podrobnosti.chybejici_fotky = { type: "array", items: { type: "string" }, description: "Které důležité fotky chybí." };
  podrobnosti.prodavajici = { type: "string", description: "Stručně o prodávajícím (hodnocení, počet recenzí, rizika)." };
  podrobnosti.otazky_na_prodavajiciho = { type: "array", items: { type: "string" } };
  if (category === "merino") {
    podrobnosti.prirodna_vlakna_pct = nullableNumber(
      "Součet přírodních vláken (merino, bavlna, hedvábí, len…) v % podle štítku nebo popisu, nebo null když složení nelze zjistit."
    );
  }

  return obj({
    verdikt: { type: "string", enum: ["KOUPIT", "ZVÁŽIT", "NEKUPOVAT"], description: "Navržený verdikt. Kód ho ještě zkontroluje a případně sníží." },
    duvody: {
      type: "array",
      items: { type: "string" },
      description: "Max. 3 hlavní důvody, každý jednou krátkou větou, od nejdůležitějšího. Česky. NEUVÁDĚJ v nich žádné ceny ani částky (Kč, EUR…) ani poměry ceny – ty zobrazí kód z dat.",
    },
    podrobnosti: obj(podrobnosti),
  });
}

function describeItem(item, category) {
  const price = item.price ? `${item.price.amount} ${item.price.currency_code}` : "neuvedeno";
  const total = item.total_item_price
    ? `${item.total_item_price.amount} ${item.total_item_price.currency_code}`
    : "neuvedeno";
  return [
    `Kategorie: ${category}`,
    `Název: ${item.title}`,
    `Značka: ${item.brand_title}`,
    `Velikost: ${item.size_title}`,
    `Stav (status_id ${item.status_id}): ${item.status}`,
    `Cena: ${price}`,
    `Celková cena (total_item_price): ${total}`,
    `Materiál: ${item.material || "neuvedeno"}`,
    `Barva: ${item.color || "neuvedeno"}`,
    `Prodávající: ${item.user && item.user.login}, hodnocení ${item.seller_rating ?? "?"}/5, recenzí ${item.seller_reviews ?? "?"}`,
    `Země nabídky: ${item.vinted_country}`,
    `Popis prodávajícího:\n${item.description || "(žádný popis)"}`,
  ].join("\n");
}

// Částka v textu: číslo + měna (Kč, CZK, €, EUR, zł, PLN, $, USD) nebo symbol před číslem.
const MONEY_REGEX = /\d[\d\s.,]*\s?(kč|czk|€|eur|zł|zl|pln|\$|usd)|[$€]\s?\d/i;

// Zkontroluje obsah odpovědi (to, co schéma zajistit neumí). Vrátí seznam problémů (prázdný = v pořádku).
function checkResponse(v) {
  const problems = [];
  const c = v.podrobnosti.cena_nove;
  const ok = (x) => typeof x === "number" && Number.isFinite(x) && x > 0;
  if (!ok(c.od_kc) || !ok(c.do_kc)) {
    problems.push("Odhad ceny nové věci (cena_nove.od_kc a do_kc) musí být vždy kladná čísla.");
  } else if (c.od_kc > c.do_kc) {
    problems.push("cena_nove.od_kc nesmí být větší než do_kc.");
  }
  if (v.duvody.some((d) => MONEY_REGEX.test(d))) {
    problems.push("Důvody nesmí obsahovat žádné ceny ani částky. Přepiš je bez nich.");
  }
  return problems;
}

// Jedno volání API se structured outputs. Vrátí { verdict, usage }.
async function callClaude(claude, { model, effort, system, content, schema }) {
  const params = {
    model,
    max_tokens: 12000,
    system,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content }],
  };
  // U vybraných modelů zapneme záložní model (fallbacks "default" = API samo vybere podle důvodu odmítnutí).
  const response = FALLBACK_MODELS.includes(model)
    ? await claude.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : await claude.messages.create(params);
  // Spustil se záložní model? (pozná se podle položky fallback_message v usage.iterations)
  const fallbackRan = (response.usage.iterations || []).some((entry) => entry.type === "fallback_message");
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude odmítl odpovědět (kategorie: ${response.stop_details && response.stop_details.category})`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Odpověď byla zkrácena (max_tokens).");
  const block = response.content.find((b) => b.type === "text");
  if (!block) throw new Error("Claude nevrátil text s hodnocením.");
  return { verdict: JSON.parse(block.text), usage: response.usage, fallbackRan, servedBy: response.model };
}

// Ohodnotí jednu nabídku. options: { model, effort }.
async function evaluate(claude, criteria, item, category, options = {}) {
  const model = options.model || modelFor(category);
  const effort = options.effort || EFFORT;
  const schema = buildSchema(category);
  const system = `Jsi asistent, který hodnotí nabídky z Vinted. Řiď se těmito pokyny:\n\n${criteria}`;
  const baseContent = [
    ...getPhotoUrls(item).map((url) => ({ type: "image", source: { type: "url", url } })),
    { type: "text", text: `Ohodnoť tuto nabídku.\n\n${describeItem(item, category)}` },
  ];

  let verdict = null;
  let problems = [];
  const usage = { input_tokens: 0, output_tokens: 0, pokusu: 0 };
  // Max. 2 pokusy: když obsah odpovědi poruší pravidla (cena chybí, cena v důvodu), Claude dostane seznam chyb a opraví ji.
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = attempt === 0
      ? baseContent
      : [...baseContent, { type: "text", text: `Tvoje předchozí odpověď měla chyby, oprav je:\n- ${problems.join("\n- ")}` }];
    const r = await callClaude(claude, { model, effort, system, content, schema });
    verdict = r.verdict;
    usage.input_tokens += r.usage.input_tokens;
    usage.output_tokens += r.usage.output_tokens;
    usage.pokusu++;
    if (r.fallbackRan) {
      usage.zalozni_model = r.servedBy; // záložní model hodnotil (alespoň jeden pokus)
      console.warn(`  [fallback] ${model} odmítl, hodnotil ${r.servedBy}`);
    }
    problems = checkResponse(verdict);
    if (problems.length === 0) break;
  }

  // Kód dopočítá poměr ceny a vloží ho k odhadu ceny nové věci.
  const podrobnosti = verdict.podrobnosti;
  podrobnosti.cena_nove.pomer_ceny = computePriceRatio(item, podrobnosti.cena_nove);

  // Kód zkontroluje navržený verdikt a případně ho sníží (nikdy nezvýší).
  const totalKc =
    item.total_item_price && item.total_item_price.currency_code === "CZK" ? Number(item.total_item_price.amount) : null;
  const ruled = applyRules({
    category,
    statusId: item.status_id,
    totalKc,
    navrzeny: verdict.verdikt,
    podrobnosti,
  });

  const record = {
    id: String(item.id),
    kategorie: category,
    nazev: item.title,
    url: item.url,
    cena_celkem: item.total_item_price ? `${item.total_item_price.amount} ${item.total_item_price.currency_code}` : null,
    stav: { status_id: item.status_id, limit_ceny_pct: ruled.limit_ceny_pct },
    navrzeny_verdikt: verdict.verdikt,
    verdikt: ruled.verdikt,
    upraveno_kodem: ruled.upraveno_kodem,
    duvody: verdict.duvody.slice(0, 3),
    podrobnosti,
    model,
    pouziti: { effort, ...usage },
    foto: getPhotoUrls(item)[0] || null,
    beh_id: options.behId || null, // ID běhu hlidac.js, ve kterém nabídka vznikla (podle něj se označují „nové“)
    hodnoceno: new Date().toISOString(),
  };
  // Pokud ani druhý pokus nevyhověl pravidlům obsahu, uložíme upozornění (např. důvod s cenou).
  if (problems.length > 0) record.upozorneni_na_odpoved = problems;
  return record;
}

// Zjednodušený záznam pro kategorii „upozornit“: bez hodnocení, jen to, co se ukazuje na stránce a v upozornění.
function makeAlertRecord(item, behId, label) {
  return {
    id: String(item.id),
    kategorie: ALERT_CATEGORY,
    stitek: label || "", // štítek z searches.txt (např. "Knihy"); prázdný = skupina „Ostatní“
    nazev: item.title,
    url: item.url,
    cena_celkem: item.total_item_price ? `${item.total_item_price.amount} ${item.total_item_price.currency_code}` : null,
    foto: getPhotoUrls(item)[0] || null,
    beh_id: behId || null,
    hodnoceno: new Date().toISOString(), // stejné jméno pole jako u hodnocených, podle něj se počítá stáří
  };
}

// ---------- Úklid starých dat ----------
// Smaže z results.json a raw-items.json nabídky starší než MAX_AGE_DAYS.
// seen.json se NEMAŽE, aby se staré nabídky, které se ještě objeví ve výsledcích Apify, znovu nehodnotily.
function cleanOldData(resultsFile = RESULTS_FILE, rawFile = RAW_FILE) {
  const limit = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  const results = readJson(resultsFile, []);
  const keptResults = results.filter((r) => Date.parse(r.hodnoceno) >= limit);
  if (keptResults.length !== results.length) writeJson(resultsFile, keptResults);

  const raw = readJson(rawFile, {});
  const keptRaw = {};
  let rawChanged = false;
  for (const [id, entry] of Object.entries(raw)) {
    if (!entry.ulozeno) {
      // Starší záznam bez data: stáří odvodíme z hodnocení, jinak ho počítáme od dneška.
      const record = results.find((r) => r.id === id);
      entry.ulozeno = record ? record.hodnoceno : new Date().toISOString();
      rawChanged = true;
    }
    if (Date.parse(entry.ulozeno) >= limit) keptRaw[id] = entry;
  }
  const removedRaw = Object.keys(raw).length - Object.keys(keptRaw).length;
  if (rawChanged || removedRaw > 0) writeJson(rawFile, keptRaw);

  const removedResults = results.length - keptResults.length;
  if (removedResults > 0 || removedRaw > 0) {
    console.log(`Úklid: smazáno ${removedResults} hodnocení a ${removedRaw} surových záznamů starších než ${MAX_AGE_DAYS} dní.`);
  }
}

// ---------- Stránka s přehledem ----------
// Vygeneruje index.html z aktuálních dat. Vrací počet nabídek na stránce.
function regeneratePage() {
  return generatePage({
    results: readJson(RESULTS_FILE, []),
    lastRun: readJson(LAST_RUN_FILE, null),
    maxAgeDays: MAX_AGE_DAYS,
    templateFile: TEMPLATE_FILE,
    outFile: INDEX_FILE,
  });
}

// ---------- Hlavní program ----------
async function main() {
  const { apify, claude } = createClients();
  const criteria = fs.readFileSync(CRITERIA_FILE, "utf8");

  cleanOldData();

  // Údaje o tomto běhu; ID běhu se ukládá ke každé nově ohodnocené nabídce (podle něj stránka pozná „nové“).
  const startedAt = new Date().toISOString();
  const run = { id: startedAt, zacatek: startedAt, konec: null, nalezeno: 0, nove: 0, uspech: false };
  writeJson(LAST_RUN_FILE, run);

  const seen = new Set(readJson(SEEN_FILE, []));
  const results = readJson(RESULTS_FILE, []);
  const spend = {}; // spotřeba tokenů podle modelu (jen za tento běh)
  const objevilo = []; // nové nabídky z kategorie „upozornit“ (pošle se o nich ntfy)
  const koupit = []; // nové nabídky s konečným verdiktem KOUPIT (pošle se o nich ntfy)

  try {
    for (const search of readSearches()) {
      console.log(`\n=== Hledání: ${search.category} ===`);
      const items = await fetchItems(apify, search);
      run.nalezeno += items.length;
      // Surová data ukládáme jen u nabídek, které jsme ještě neviděli.
      saveRawItems(search.category, items.filter((item) => !seen.has(String(item.id))));
      console.log(`Apify vrátilo ${items.length} nabídek.`);

      for (const item of items) {
        const id = String(item.id);
        if (seen.has(id)) {
          console.log(`- ${id}: už viděno, přeskakuji`);
          continue;
        }

        // Kategorie „upozornit“: žádné předvyřazení ani hodnocení Claudem, jen uložit a upozornit.
        if (search.category === ALERT_CATEGORY) {
          const record = makeAlertRecord(item, run.id, search.label);
          results.push(record);
          objevilo.push(record);
          run.nove++;
          writeJson(RESULTS_FILE, results);
          seen.add(id);
          writeJson(SEEN_FILE, [...seen]);
          console.log(`- ${id}: UPOZORNIT – ${item.title}`);
          continue;
        }

        const reason = prefilterReason(item, search.category);
        if (reason) {
          console.log(`- ${id}: vyřazeno předem (${reason})`);
          seen.add(id);
          writeJson(SEEN_FILE, [...seen]);
          continue;
        }

        try {
          const record = await evaluate(claude, criteria, item, search.category, { behId: run.id });
          results.push(record);
          run.nove++;
          if (record.verdikt === "KOUPIT") koupit.push(record);
          const s = (spend[record.model] = spend[record.model] || { input: 0, output: 0, nabidek: 0 });
          s.input += record.pouziti.input_tokens;
          s.output += record.pouziti.output_tokens;
          s.nabidek++;
          // Ukládáme hned, aby se při pozdější chybě nic neztratilo.
          writeJson(RESULTS_FILE, results);
          seen.add(id);
          writeJson(SEEN_FILE, [...seen]);
          console.log(`- ${id}: ${record.verdikt} – ${item.title}`);
        } catch (err) {
          // Nabídku nezapíšeme jako viděnou, příště se zkusí znovu.
          console.error(`- ${id}: chyba při hodnocení (${err.message})`);
        }
      }
    }

    // Orientační náklady na Claude API za tento běh (z počtu tokenů a ceníku; Apify se účtuje zvlášť).
    let totalUsd = 0;
    for (const [model, s] of Object.entries(spend)) {
      const p = PRICES[model];
      const usd = p ? (s.input * p.input + s.output * p.output) / 1e6 : null;
      if (usd !== null) totalUsd += usd;
      console.log(`Spotřeba ${model}: ${s.nabidek} nabídek, vstup ${s.input} tok., výstup ${s.output} tok.${usd !== null ? `, ≈ $${usd.toFixed(4)}` : ""}`);
    }
    if (totalUsd > 0) console.log(`Claude API celkem ≈ $${totalUsd.toFixed(4)}`);
    run.uspech = true; // workflow podle toho pozná, že dnešní běh se povedl (pak další plánované běhy přeskočí)
  } finally {
    // I když běh skončí chybou, uložíme údaje o běhu a přegenerujeme stránku s tím, co už je hotové.
    run.konec = new Date().toISOString();
    writeJson(LAST_RUN_FILE, run);
    try {
      const count = regeneratePage();
      console.log(`\nStránka index.html vygenerována (${count} nabídek).`);
    } catch (err) {
      console.error(`Stránku se nepodařilo vygenerovat: ${err.message}`);
    }
    // Upozornění přes ntfy (i po chybě – nabídky už jsou uložené jako viděné, jinak by o nich nikdo nevěděl).
    // sendNotification nikdy nevyhodí chybu.
    const notification = buildNotification(objevilo, koupit);
    if (notification) await sendNotification(notification);
    else console.log("ntfy: nic nového, neposílám upozornění.");
  }
  console.log("Hotovo. Výsledky jsou v results.json, přehled v index.html");
}

// Soubor jde spustit přímo (node hlidac.js) i použít z jiného skriptu.
module.exports = {
  MODEL_BY_CATEGORY, MAX_AGE_DAYS, CRITERIA_FILE, RAW_FILE, cleanOldData, regeneratePage, readJson, writeJson, createClients, prefilterReason, saveRawItems, evaluate, computePriceRatio,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("CHYBA:", err.message);
    process.exit(1);
  });
}
