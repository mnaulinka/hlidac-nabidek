// pravidla.js – pevná pravidla, která vynucuje kód (ne Claude).
//
// Claude vrací fakta + NAVRŽENÝ verdikt. Tady se verdikt zkontroluje a případně SNÍŽÍ
// (KOUPIT -> ZVÁŽIT -> NEKUPOVAT). Nikdy se nezvyšuje. Každá změna se zapíše s poznámkou,
// které pravidlo rozhodlo.

const RANK = { NEKUPOVAT: 0, "ZVÁŽIT": 1, KOUPIT: 2 };

const MIN_NATURAL_FIBRE_PCT = 80; // merino: min. přírodních vláken
const AGE_NEVER_LIMIT = 6; // nad kolik let je bunda NEKUPOVAT
const AGE_OK_LIMIT = 4; // do kolika let je stáří v pořádku
const PRICE_LIMIT_NEW_PCT = 80; // nové (status_id 6 a 1)
const PRICE_LIMIT_VERY_GOOD_PCT = 60; // velmi dobrý (status_id 2)
const CONFIDENT = ["jisté", "pravděpodobné"]; // jistota ceny potřebná pro KOUPIT

// Limit ceny v % z ceny nové podle stavu nabídky.
function priceLimitPct(statusId) {
  return statusId === 2 ? PRICE_LIMIT_VERY_GOOD_PCT : PRICE_LIMIT_NEW_PCT;
}

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const fmt = (x) => Math.round(x * 10) / 10;

// Vstup: category ("bundy"/"merino"), statusId, totalKc (celková cena nabídky v Kč, nebo null),
//        navrzeny (verdikt od Clauda), podrobnosti (odpověď Clauda).
// Výstup: { verdikt, upraveno_kodem: [{ pravidlo, z, na, poznamka }], limit_ceny_pct }
function applyRules({ category, statusId, totalKc, navrzeny, podrobnosti }) {
  let verdikt = navrzeny;
  const changes = [];

  // Sníží verdikt na `to`, jen pokud je to opravdu nižší než současný.
  const lowerTo = (to, pravidlo, poznamka) => {
    if (RANK[to] < RANK[verdikt]) {
      changes.push({ pravidlo, z: verdikt, na: to, poznamka });
      verdikt = to;
    }
  };
  const capAtMaybe = (pravidlo, poznamka) => lowerTo("ZVÁŽIT", pravidlo, poznamka);

  const p = podrobnosti || {};

  // ----- Merino: přírodní vlákna -----
  if (category === "merino") {
    const pct = p.prirodna_vlakna_pct;
    if (isNum(pct)) {
      if (pct < MIN_NATURAL_FIBRE_PCT) {
        lowerTo("NEKUPOVAT", "merino_prirodna_vlakna", `Přírodní vlákna ${fmt(pct)} % < ${MIN_NATURAL_FIBRE_PCT} %.`);
      }
    } else {
      capAtMaybe("merino_slozeni_neznamo", "Podíl přírodních vláken nelze zjistit, nejvýš ZVÁŽIT.");
    }
  }

  // ----- Bundy: typ izolace a stáří -----
  if (category === "bundy") {
    const typ = p.typ_izolace;
    if (typ === "bez izolace" || typ === "nezjištěno") {
      capAtMaybe("typ_izolace", `Typ izolace „${typ}“, mimo pravidla pro stáří, nejvýš ZVÁŽIT.`);
    }
    if (typ !== "bez izolace") {
      const age = p.stari_modelu || {};
      const od = isNum(age.od_let) ? age.od_let : isNum(age.do_let) ? age.do_let : null;
      const dok = isNum(age.do_let) ? age.do_let : od;
      if (od === null) {
        capAtMaybe("stari_neurceno", "Stáří nelze odhadnout, nejvýš ZVÁŽIT.");
      } else {
        if (od > AGE_NEVER_LIMIT) {
          lowerTo("NEKUPOVAT", "stari_nad_6_let", `Stáří ${fmt(od)}–${fmt(dok)} let, i dolní odhad je nad ${AGE_NEVER_LIMIT} let.`);
        } else if (dok > AGE_OK_LIMIT) {
          capAtMaybe("stari_4_6_let", `Stáří ${fmt(od)}–${fmt(dok)} let, horní odhad je nad ${AGE_OK_LIMIT} roky, nejvýš ZVÁŽIT.`);
        }
        if (age.jistota === "nejisté") {
          capAtMaybe("stari_nejiste", "Odhad stáří je nejistý, nejvýš ZVÁŽIT.");
        }
      }
    }
  }

  // ----- Cena (bundy i merino) -----
  const limit = priceLimitPct(statusId);
  const cena = p.cena_nove || {};
  const priceOk = isNum(totalKc) && totalKc > 0 && isNum(cena.od_kc) && isNum(cena.do_kc) && cena.od_kc > 0 && cena.do_kc > 0;
  if (!priceOk) {
    capAtMaybe("cena_chybi", "Chybí použitelný odhad ceny nové věci nebo celková cena, nejvýš ZVÁŽIT.");
  } else {
    const ratioLow = (totalKc / cena.od_kc) * 100; // při DOLNÍ mezi ceny nové (vyšší poměr)
    const ratioHigh = (totalKc / cena.do_kc) * 100; // při HORNÍ mezi ceny nové (nižší poměr)
    if (ratioHigh > limit) {
      lowerTo("NEKUPOVAT", "cena_nad_limit", `Poměr ceny i při horní mezi ceny nové je ${fmt(ratioHigh)} %, limit ${limit} %.`);
    }
    if (!CONFIDENT.includes(cena.jistota)) {
      capAtMaybe("cena_nejista", `Jistota odhadu ceny nové je „${cena.jistota}“, KOUPIT není možné.`);
    }
    if (ratioLow > limit) {
      capAtMaybe("cena_dolni_mez_nad_limit", `Poměr ceny při dolní mezi ceny nové je ${fmt(ratioLow)} %, limit ${limit} %, nejvýš ZVÁŽIT.`);
    }
  }

  return { verdikt, upraveno_kodem: changes, limit_ceny_pct: limit };
}

module.exports = { applyRules, priceLimitPct, RANK };
