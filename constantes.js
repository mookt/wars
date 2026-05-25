// ============================================================
//  CONSTANTES.JS — Valeurs de production partagées
//  Modifier ici affecte toutes les routes ET le flush périodique
// ============================================================

const BETON = {
    prod : [0, 1, 2, 4, 7, 11, 16, 22, 29, 37, 4006],
    max  : [0, 5000, 10000, 20000, 35000, 55000, 80000, 110000, 145000, 185000, 230000],
    cout : [0, 0, 200, 500, 1000, 2000, 4000, 7500, 13000, 21000, 32000],
};

const ACIER = {
    prod : [0, 1, 2, 4, 7, 11, 16, 22, 29, 37, 46],
    max  : [0, 500, 1000, 2000, 3500, 5500, 8000, 11000, 14500, 18500, 23000],
    cout : [0, 0, 200, 500, 1000, 2000, 4000, 7500, 13000, 21000, 32000],
};

const CHARBON = {
    prod : [0, 1, 2, 4, 7, 11, 16, 22, 29, 37, 46],
    max  : [0, 500, 1000, 2000, 3500, 5500, 8000, 11000, 14500, 18500, 23000],
    cout : [0, 0, 200, 500, 1000, 2000, 4000, 7500, 13000, 21000, 32000],
};

const CARBURANT = {
    prod : [0, 1, 2, 4, 7, 11, 16, 22, 29, 37, 46],
    max  : [0, 500, 1000, 2000, 3500, 5500, 8000, 11000, 14500, 18500, 23000],
    cout : [0, 0, 200, 500, 1000, 2000, 4000, 7500, 13000, 21000, 32000],
};

const TITANIUM = {
    max : 99999,
};

const VEHICULES = {
    jeep:   { pv_max: 600, attaque: 10, portee: 500, cooldown: 1000, speed: 2.15, cout_acier: 100, cout_charbon: 50,  conso_carburant: 10, temps_construction: 5000  },
    humvet: { pv_max: 6000, attaque: 20, portee: 300, cooldown: 1000, speed: 2, cout_acier: 200, cout_charbon: 100, conso_carburant: 2,  temps_construction: 5000 },
    sam:    { pv_max: 800, attaque: 300, portee: 500, cooldown: 3000, speed: 0,    cout_acier: 1, cout_charbon: 1,  conso_carburant: 0,  temps_construction: 5000  },
    tt:     { pv_max: 5000, attaque: 1500,  portee: 400, cooldown: 800,  speed: 2.5,  cout_acier: 150, cout_charbon: 75, conso_carburant: 12, temps_construction: 5000  },
};

function calculerRessource(val, niveau, dernierUpdate, C) {
    if (!niveau || !dernierUpdate) return val ?? 0;
    const elapsed = (Date.now() - Number(dernierUpdate)) / 1000;
    return Math.min(C.max[niveau], (val ?? 0) + Math.floor(elapsed * C.prod[niveau]));
}

module.exports = { BETON, ACIER, CHARBON, CARBURANT, TITANIUM, VEHICULES, calculerRessource };
