// vytvor-ikony.js – vyrobí ikonu stránky (lupa na barvě #007782) jako SVG i PNG v několika velikostech.
//
// Spuštění (zdarma, bez instalace čehokoli):   node ikony/vytvor-ikony.js
// Výsledek se uloží vedle tohoto souboru:
//   ikona.svg             – ikona pro záložku prohlížeče (zaoblený čtverec)
//   ikona-32.png          – záloha pro prohlížeče, které SVG ikonu neumí (např. Safari)
//   apple-touch-icon.png  – 180×180, ikona na ploše iPhonu (iOS si rohy zaoblí sám)
//   ikona-192.png, ikona-512.png – pro „Přidat na plochu“ v Androidu
//
// Barvu nebo tvar změníš v nastavení hned níže a skript znovu spustíš.
// PNG kreslí skript sám (žádná knihovna): každý bod se vzorkuje 4×4 krát, aby byly hrany hladké.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---------- Nastavení (kreslí se na plátno 512 × 512) ----------
const BARVA = [0x00, 0x77, 0x82]; // #007782, hlavní barva stránky
const BILA = [255, 255, 255];
// Lupa: kroužek + držadlo. Je záměrně menší a uprostřed, aby ji Android při oříznutí ikony do kruhu neuřízl.
const KROUZEK = { x: 226, y: 226, polomer: 96, tloustka: 36 };
const DRZADLO = { x1: 294, y1: 294, x2: 372, y2: 372, tloustka: 44 };
const ZAOBLENI_SVG = 104; // zaoblení rohů jen u SVG (PNG jsou celé čtverce, Android/iOS si je zaoblí samy)
const VELIKOSTI = { "ikona-32.png": 32, "apple-touch-icon.png": 180, "ikona-192.png": 192, "ikona-512.png": 512 };
const VZORKU = 4; // vyhlazení hran: 4 × 4 vzorky na bod

// ---------- SVG ----------
function svg() {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" rx="${ZAOBLENI_SVG}" fill="#${BARVA.map((c) => c.toString(16).padStart(2, "0")).join("")}"/>` +
    `<circle cx="${KROUZEK.x}" cy="${KROUZEK.y}" r="${KROUZEK.polomer}" fill="none" stroke="#fff" stroke-width="${KROUZEK.tloustka}"/>` +
    `<line x1="${DRZADLO.x1}" y1="${DRZADLO.y1}" x2="${DRZADLO.x2}" y2="${DRZADLO.y2}" stroke="#fff" stroke-width="${DRZADLO.tloustka}" stroke-linecap="round"/>` +
    `</svg>\n`
  );
}

// ---------- Kreslení bodu: je tu bílá (lupa), nebo barva pozadí? ----------
function jeBila(x, y) {
  // kroužek: vzdálenost od středu je blízko polomeru
  const d = Math.hypot(x - KROUZEK.x, y - KROUZEK.y);
  if (Math.abs(d - KROUZEK.polomer) <= KROUZEK.tloustka / 2) return true;
  // držadlo: vzdálenost od úsečky (se zaoblenými konci)
  const dx = DRZADLO.x2 - DRZADLO.x1, dy = DRZADLO.y2 - DRZADLO.y1;
  const t = Math.max(0, Math.min(1, ((x - DRZADLO.x1) * dx + (y - DRZADLO.y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (DRZADLO.x1 + t * dx), y - (DRZADLO.y1 + t * dy)) <= DRZADLO.tloustka / 2;
}

// ---------- PNG (bez alfa kanálu, 8 bitů RGB) ----------
function png(velikost) {
  const radek = velikost * 3 + 1; // 1 bajt filtru + pixely
  const data = Buffer.alloc(radek * velikost);
  const mereni = 512 / velikost;
  for (let py = 0; py < velikost; py++) {
    data[py * radek] = 0; // filtr "žádný"
    for (let px = 0; px < velikost; px++) {
      let bile = 0;
      for (let sy = 0; sy < VZORKU; sy++) {
        for (let sx = 0; sx < VZORKU; sx++) {
          if (jeBila((px + (sx + 0.5) / VZORKU) * mereni, (py + (sy + 0.5) / VZORKU) * mereni)) bile++;
        }
      }
      const podil = bile / (VZORKU * VZORKU);
      for (let k = 0; k < 3; k++) {
        data[py * radek + 1 + px * 3 + k] = Math.round(BARVA[k] * (1 - podil) + BILA[k] * podil);
      }
    }
  }
  const blok = (typ, obsah) => {
    const t = Buffer.from(typ, "ascii");
    const delka = Buffer.alloc(4); delka.writeUInt32BE(obsah.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, obsah])) >>> 0);
    return Buffer.concat([delka, t, obsah, crc]);
  };
  const hlavicka = Buffer.alloc(13);
  hlavicka.writeUInt32BE(velikost, 0); hlavicka.writeUInt32BE(velikost, 4);
  hlavicka[8] = 8; hlavicka[9] = 2; // 8 bitů, barevný model RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blok("IHDR", hlavicka),
    blok("IDAT", zlib.deflateSync(data, { level: 9 })),
    blok("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Uložení ----------
const slozka = __dirname;
fs.writeFileSync(path.join(slozka, "ikona.svg"), svg(), "utf8");
for (const [nazev, velikost] of Object.entries(VELIKOSTI)) {
  fs.writeFileSync(path.join(slozka, nazev), png(velikost));
}
console.log("Hotovo: ikona.svg a", Object.keys(VELIKOSTI).join(", "));
