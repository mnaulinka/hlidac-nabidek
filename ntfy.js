// ntfy.js – posílání upozornění na telefon přes službu ntfy (https://ntfy.sh).
//
// Název kanálu (topic) se bere z proměnné prostředí NTFY_TOPIC: na GitHubu ze Secrets, u tebe na počítači ze
// souboru .env. Název kanálu je jediná "ochrana" – kdo ho zná, může zprávy číst i psát. Proto se nikdy
// nevypisuje do logu a nesmí být v kódu ani v README.
//
// Zkušební zpráva (jednorázově, ověří, že ti upozornění chodí):   node ntfy.js --test

const path = require("path");
const fs = require("fs");

const NTFY_URL = "https://ntfy.sh";
const PAGE_URL = "https://mnaulinka.github.io/hlidac-nabidek/"; // klepnutí na souhrnnou zprávu otevře přehled
const MAX_MESSAGE_BYTES = 3800; // ntfy přijme zprávu do 4096 bajtů

// "2319.87 CZK" -> "2 320 Kč"
function formatPrice(text) {
  if (!text) return "cena neuvedena";
  const [amount, currency] = String(text).split(" ");
  if (currency === "CZK" && Number.isFinite(Number(amount))) {
    return Math.round(Number(amount)).toLocaleString("cs-CZ").replace(/ /g, " ") + " Kč";
  }
  return text;
}

// Odkaz posíláme jen, pokud je to opravdu https (stejně jako na stránce).
const safeUrl = (url) => (/^https:\/\//.test(String(url || "")) ? url : null);

function offerLine(offer) {
  const url = safeUrl(offer.url);
  return `${offer.nazev} – ${formatPrice(offer.cena_celkem)}` + (url ? `\n${url}` : "");
}

// Sestaví zprávu (nic neposílá, jde snadno vyzkoušet).
//   objevilo: nové nabídky z kategorie "upozornit"; koupit: nové nabídky s verdiktem KOUPIT.
// Vrací { title, message, click } nebo null, když není o čem upozornit.
function buildNotification(objevilo, koupit) {
  const total = objevilo.length + koupit.length;
  if (total === 0) return null;

  // Jedna nabídka = samostatná zpráva; klepnutí otevře rovnou Vinted.
  if (total === 1) {
    const offer = (objevilo[0] || koupit[0]);
    return {
      title: objevilo.length === 1 ? (offer.stitek ? `Objevilo se: ${offer.stitek}` : "Objevilo se!") : "KOUPIT",
      message: offerLine(offer),
      click: safeUrl(offer.url),
    };
  }

  // Víc nabídek = jedna souhrnná zpráva; klepnutí otevře přehled.
  const parts = [];
  // Nabídky „Objevilo se“ se seskupí podle štítku z searches.txt (bez štítku = „Ostatní“), v pořadí prvního výskytu.
  const groups = new Map();
  for (const offer of objevilo) {
    const name = offer.stitek || "Ostatní";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(offer);
  }
  for (const [name, offers] of groups) {
    parts.push(`${name.toUpperCase()} (${offers.length}):\n` + offers.map(offerLine).join("\n\n"));
  }
  if (koupit.length > 0) parts.push(`KOUPIT (${koupit.length}):\n` + koupit.map(offerLine).join("\n\n"));
  let message = parts.join("\n\n");
  if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) {
    // Příliš dlouhé: odřízneme po celých řádcích a připojíme odkaz na přehled.
    const lines = message.split("\n");
    while (lines.length > 1 && Buffer.byteLength(lines.join("\n") + "\n…víc na stránce", "utf8") > MAX_MESSAGE_BYTES) lines.pop();
    message = lines.join("\n") + "\n…víc na stránce";
  }
  return { title: `Hlídač: ${total} nových nabídek`, message, click: PAGE_URL };
}

// Pošle zprávu na ntfy. Nikdy nevyhodí chybu (neúspěch jen vypíše), aby kvůli upozornění nespadl celý běh.
// Vrací true, když se zpráva odeslala.
async function sendNotification(notification) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    console.log("ntfy: proměnná NTFY_TOPIC není nastavená, upozornění se neposílá.");
    return false;
  }
  try {
    // JSON způsob posílání: čeština v textu projde bez problémů (v hlavičkách by nešla).
    const body = { topic, title: notification.title, message: notification.message };
    if (notification.click) body.click = notification.click;
    const response = await fetch(NTFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error(`ntfy: odeslání se nepovedlo (HTTP ${response.status}).`);
      return false;
    }
    console.log(`ntfy: upozornění odesláno ("${notification.title}").`);
    return true;
  } catch (err) {
    console.error(`ntfy: odeslání se nepovedlo (${err.message}).`);
    return false;
  }
}

module.exports = { buildNotification, sendNotification, formatPrice };

// node ntfy.js --test -> pošle zkušební zprávu
if (require.main === module) {
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  if (process.argv.includes("--test")) {
    sendNotification({
      title: "Hlídač nabídek – zkouška",
      message: "Pokud to čteš na telefonu, upozornění fungují.",
      click: PAGE_URL,
    }).then((ok) => process.exit(ok ? 0 : 1));
  } else {
    console.log("Použití: node ntfy.js --test");
  }
}
