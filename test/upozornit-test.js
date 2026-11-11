// Test kategorie „upozornit“ – bez Apify, bez Clauda, bez posílání na ntfy (zdarma):
//     node test/upozornit-test.js
// Ověří sestavení zpráv pro ntfy a vygeneruje zkušební stránku test/index-upozornit.html se sekcí „Objevilo se!“.

const path = require("path");
const assert = require("assert");
const { buildNotification } = require("../ntfy.js");
const { generatePage } = require("../stranka.js");
const h = require("../hlidac.js");

const kniha = (id, nazev, cena) => ({
  id, kategorie: "upozornit", nazev, url: `https://www.vinted.cz/items/${id}`, cena_celkem: cena, foto: null,
  beh_id: "beh-1", hodnoceno: new Date().toISOString(),
});
const k1 = { ...kniha("1", "Harry Potter – kniha", "150.00 CZK"), stitek: "Knihy" };
const k2 = { ...kniha("2", "Hobit", "99.50 CZK"), stitek: "Knihy" };
const k3 = { ...kniha("4", "Peerko boty", "800.00 CZK"), stitek: "Boty" };
const k4 = kniha("5", "Něco bez štítku", "50.00 CZK");
const bunda = { id: "3", kategorie: "bundy", nazev: "Haglöfs bunda", url: "https://www.vinted.cz/items/3", cena_celkem: "1500.00 CZK", verdikt: "KOUPIT" };

// 1) Nic nového -> žádná zpráva
assert.strictEqual(buildNotification([], []), null);

// 2) Jedna nabídka -> samostatná zpráva s odkazem na Vinted
const jedna = buildNotification([k1], []);
assert.strictEqual(jedna.title, "Objevilo se: Knihy");
assert.strictEqual(buildNotification([k4], []).title, "Objevilo se!");
assert.ok(jedna.message.includes("Harry Potter – kniha – 150 Kč"));
assert.strictEqual(jedna.click, k1.url);
const jednaKoupit = buildNotification([], [bunda]);
assert.strictEqual(jednaKoupit.title, "KOUPIT");

// 3) Víc nabídek (i z obou skupin) -> jedna souhrnná zpráva
const souhrn = buildNotification([k1, k2], [bunda]);
assert.ok(souhrn.title.includes("3 nových"));
assert.ok(souhrn.message.includes("KNIHY (2)") && souhrn.message.includes("KOUPIT (1)"));
assert.ok(souhrn.message.includes(k2.url) && souhrn.message.includes(bunda.url));

// 3b) Seskupení podle štítku
const skup = buildNotification([k1, k3, k2, k4], []);
assert.ok(skup.message.includes("KNIHY (2)") && skup.message.includes("BOTY (1)") && skup.message.includes("OSTATNÍ (1)"));
assert.ok(!skup.message.includes("OBJEVILO SE"));

// 4) Hodně nabídek -> zpráva se vejde do limitu ntfy
const mnoho = Array.from({ length: 80 }, (_, i) => kniha(String(i), "Kniha číslo " + i + " s dlouhým názvem", "100.00 CZK"));
assert.ok(Buffer.byteLength(buildNotification(mnoho, []).message, "utf8") <= 4096);

// 5) Stránka: upozornit mimo hodnocené, vlastní sekce
const out = path.join(__dirname, "index-upozornit.html");
const count = generatePage({
  results: [k1, k2, k3, k4, bunda].map((r) => ({ ...r, hodnoceno: r.hodnoceno || new Date().toISOString() })),
  lastRun: { id: "beh-1", zacatek: new Date().toISOString(), nalezeno: 3, nove: 3 },
  maxAgeDays: h.MAX_AGE_DAYS,
  templateFile: path.join(__dirname, "..", "sablona.html"),
  outFile: out,
});
assert.strictEqual(count, 5);
const html = require("fs").readFileSync(out, "utf8");
assert.ok(html.includes('"objevilo":[') && html.includes("Harry Potter"));
console.log("OK – všechny kontroly prošly. Zkušební stránka:", out);
