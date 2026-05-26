// ── Construction & boutons ────────────────────────────────────
function signalerArrivee(vehicle) {
    if (!vehicle._enMouvement) return;
    vehicle._enMouvement = false;
    const x = isFinite(vehicle.cur_x) ? vehicle.cur_x : null;
    const y = isFinite(vehicle.cur_y) ? vehicle.cur_y : null;
    fetch(`/api/joueur/${joueur_id}/jeep/arrive`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicule_id: vehicle.id, x, y })
    }).catch(() => null);
}

async function deplacerVehicule(base, vehicle, mapX, mapY) {
    vehicle.x = mapX; vehicle.y = mapY;
    vehicle._enMouvement = true;
    vehicle._stuck = null;
    await fetch(`/api/joueur/${joueur_id}/jeep/deplacer`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: mapX, y: mapY, vehicule_id: vehicle.id, from_x: vehicle.cur_x, from_y: vehicle.cur_y })
    }).catch(() => null);
}

// ── File d'attente — une file indépendante par base ──────────
// Clé : 'main' pour la base principale, _neutreId (nombre) pour les bases capturées
const _LS_KEY_FILES = `warzone_files_${joueur_id}`;
const _filesAttente  = JSON.parse(localStorage.getItem(_LS_KEY_FILES) ?? '{}');
const _filetypes     = {};   // { 'main': 'jeep', ... }  type en attente (queue)
const _buildTypes    = {};   // { 'main': 'jeep', ... }  type ACTUELLEMENT en construction
const _gracesActives = {};   // { 'main': false, ... }

function _sauvegarderFiles() {
    localStorage.setItem(_LS_KEY_FILES, JSON.stringify(_filesAttente));
}

function _cleBase() {
    return (typeof _baseCaptureeActive !== 'undefined' && _baseCaptureeActive)
        ? _baseCaptureeActive._neutreId
        : 'main';
}
function _cleBaseDeVehicule(vehicle) {
    for (const b of bases) {
        if (b.vehicules?.includes(vehicle)) return b._neutreId ?? 'main';
    }
    return 'main';
}
function _getFile(cle)  { return _filesAttente[cle]  ?? 0;    }
function _getType(cle)  { return _filetypes[cle]     ?? null; }
function _getGrace(cle) { return _gracesActives[cle] ?? false; }

// ── Popup file d'attente ─────────────────────────────────────
function ouvrirPopupFile() {
    const slider = document.getElementById('popup-slider');
    const fa = _getFile(_cleBase());
    slider.min   = fa;
    slider.value = fa;
    majPopupFile();
    document.getElementById('popup-file').style.display = 'flex';
}
function fermerPopupFile() {
    document.getElementById('popup-file').style.display = 'none';
}
function setPopupVal(n) {
    const slider = document.getElementById('popup-slider');
    slider.value = Math.max(Number(slider.min), n);
    majPopupFile();
}
function _coutIncrementel(newTotal) {
    const fa = _getFile(_cleBase());
    const dejaPayé = fa === 0 ? 0 : Math.ceil(fa / 10) * 1000;
    const total    = newTotal === 0 ? 0 : Math.ceil(newTotal / 10) * 1000;
    return Math.max(0, total - dejaPayé);
}
function majPopupFile() {
    const n     = Number(document.getElementById('popup-slider').value);
    const ajout = n - _getFile(_cleBase());
    const cout  = _coutIncrementel(n);
    document.getElementById('popup-qty').textContent =
        ajout > 0 ? `+${ajout} → total ${n}×` : `${n}×`;
    document.getElementById('popup-cout').textContent =
        cout > 0 ? `Carburant : ${cout.toLocaleString()}` : 'Carburant : gratuit';
}
async function validerPopupFile() {
    const cle  = _cleBase();
    const n    = Number(document.getElementById('popup-slider').value);
    const cout = _coutIncrementel(n);
    if (cout > 0) {
        const res = await fetch(`/api/joueur/${joueur_id}/construction/fuel`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: cout })
        }).catch(() => null);
        if (!res || !res.ok) {
            const err = await res?.json().catch(() => ({}));
            afficherMessageErreur(err?.erreur ?? 'Carburant insuffisant');
            return;
        }
        chargerCarburant();
    }
    _filesAttente[cle] = n;
    _sauvegarderFiles();
    _majCompteurFile();
    fermerPopupFile();
}

function _majCompteurFile() {
    const el = document.getElementById('pnv-qty-val');
    if (el) el.textContent = _getFile(_cleBase());
}

function chargerQueueBadges() { return Promise.resolve(0); } // plus de file serveur

// ── Icônes grille ────────────────────────────────────────────
function dessinerIconeVehicule(type) {
    const canvas = document.getElementById(`icon-${type}`);
    if (!canvas) return;
    const img = getVehicleImg({ type });
    const draw = () => {
        if (!img.complete || !img.naturalWidth) return;
        const ctx = canvas.getContext('2d');
        const fw = img.naturalWidth / VEHICLE_FRAMES;
        const fh = img.naturalHeight;
        // frame 18 ≈ direction droite pour jeep/humvet ; frame 0 = face droite pour TT
        const frame = type === 'tt' ? 0 : 18;
        const scale = Math.min(60 / fw, 60 / fh);
        const dw = fw * scale, dh = fh * scale;
        ctx.clearRect(0, 0, 60, 60);
        ctx.drawImage(img, frame * fw, 0, fw, fh, (60-dw)/2, (60-dh)/2, dw, dh);
    };
    if (img.complete && img.naturalWidth) draw();
    else img.addEventListener('load', draw);
}

function initIconesVehicules() {
    dessinerIconeVehicule('jeep');
    dessinerIconeVehicule('humvet');
    dessinerIconeVehicule('sam');
    dessinerIconeVehicule('tt');
}
setTimeout(() => { initIconesVehicules(); _majCompteurFile(); majEtatVehicules(); }, 500);

function survolVehicule(type) {
    const nameEl   = document.getElementById('pnv-name');
    const detailEl = document.getElementById('pnv-details');
    if (!type) {
        nameEl.textContent   = 'VÉHICULES';
        detailEl.textContent = '';
        return;
    }
    const cfg  = VEHICLE_CONFIG[type];
    const noms = { jeep: '🚗 JEEP', humvet: '🛻 HUMVET', sam: '🪖 SAM (DÉFENSE)' };
    const secs = Math.round((cfg.temps_construction ?? 30000) / 1000);
    nameEl.textContent   = noms[type] ?? type.toUpperCase();
    detailEl.innerHTML   = `⚙ ${cfg.cout_acier} acier &nbsp;🪨 ${cfg.cout_charbon} charbon &nbsp;⏱ ${secs}s`;
}

// Clic sur une cellule : lance 1 construction de ce type
function celluleVehiculeClick(type, e) {
    if (e.target.closest('.pnv-cancel-btn')) return;
    const cle = _cleBase();
    _filetypes[cle] = type;
    _lancerConstruction(type, cle);
}

async function _lancerConstruction(type, cle) {
    cle = cle ?? _cleBase();
    _buildTypes[cle] = type;   // tracker le type réellement en construction
    if (cle !== 'main') {
        const base = bases.find(b => b._neutreId === cle && b.joueur_id == joueur_id);
        if (base) {
            _baseCaptureeSelectionnee = base;
            await construireSurBaseCapturee(type);
        }
        return;
    }
    if (type === 'jeep')   await construireJeep();
    if (type === 'humvet') await construireHumvet();
    if (type === 'sam')    await construireSam();
    if (type === 'tt')     await construireTT();
}

// Appelé quand une construction se termine (par base)
function _onConstructionTerminee(cle) {
    cle = cle ?? 'main';
    _gracesActives[cle] = true;
    majEtatVehicules();
    setTimeout(() => {
        _gracesActives[cle] = false;
        const fa = _getFile(cle);
        const ft = _getType(cle);
        if (fa > 0 && ft) {
            _filesAttente[cle]--;
            _sauvegarderFiles();
            _majCompteurFile();
            _lancerConstruction(ft, cle);   // met à jour _buildTypes[cle] = ft
        } else {
            _buildTypes[cle] = null;        // fin de file, plus rien en construction
            majEtatVehicules();
        }
    }, 1000);
}

function annulerConstruction(e) {
    e.stopPropagation();
    // Confirmation dans le style du jeu
    const overlay = document.createElement('div');
    overlay.id = 'confirm-annulation';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
        <div style="background:#0d1a10;border:1px solid rgba(255,60,60,0.6);border-radius:8px;padding:24px 32px;
                    font-family:Rajdhani,sans-serif;color:#ff6666;text-align:center;min-width:260px;
                    box-shadow:0 0 30px rgba(200,0,0,0.2)">
            <div style="font-size:17px;font-weight:700;margin-bottom:12px">ANNULER LA CONSTRUCTION ?</div>
            <div style="font-size:12px;color:#aa4444;font-family:'Share Tech Mono',monospace;margin-bottom:18px">
                Le véhicule en cours sera perdu.
            </div>
            <div style="display:flex;gap:12px;justify-content:center">
                <button id="confirm-oui" style="background:rgba(200,0,0,0.2);border:1px solid #cc3333;color:#ff6666;
                    font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;padding:8px 22px;
                    cursor:pointer;border-radius:4px">OUI, ANNULER</button>
                <button id="confirm-non" style="background:rgba(0,200,80,0.1);border:1px solid #00c850;color:#00c850;
                    font-family:Rajdhani,sans-serif;font-weight:700;font-size:14px;padding:8px 22px;
                    cursor:pointer;border-radius:4px">NON, CONTINUER</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    // Capturer la base cible au moment de l'ouverture de la confirmation
    const cleCible  = _cleBase();
    const baseCible = cleCible !== 'main'
        ? bases.find(b => b._neutreId === cleCible && b.joueur_id == joueur_id)
        : bases.find(b => b.joueur_id == joueur_id && !b._neutreId);

    document.getElementById('confirm-non').onclick  = () => overlay.remove();
    document.getElementById('confirm-oui').onclick  = async () => {
        overlay.remove();
        if (!baseCible?.vehicules) return;
        const idx = baseCible.vehicules.findIndex(v => !v.construit && v.construction_fin);
        if (idx >= 0) baseCible.vehicules.splice(idx, 1);
        const qs = cleCible !== 'main' ? `?base_id=${cleCible}` : '';
        await fetch(`/api/joueur/${joueur_id}/construction/current${qs}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
        }).catch(() => null);
        majEtatVehicules();
        chargerAcier(); chargerCharbon();
        _filetypes[cleCible] = null;  // arrêter la répétition auto
        _buildTypes[cleCible] = null; // plus rien en construction sur cette base
    };
}

// Met à jour les overlays, coches et grisage selon l'état des véhicules
function majEtatVehicules() {
    const cle = _cleBase();
    const baseActive = cle !== 'main'
        ? bases.find(b => b._neutreId === cle && b.joueur_id == joueur_id)
        : bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
    if (!baseActive?.vehicules) return;

    const _now = Date.now();
    const graceOuEnCours = _getGrace(cle) || baseActive.vehicules.some(v => v.construit !== 1 && v.construction_fin && v.construction_fin > _now);
    for (const type of ['jeep', 'humvet', 'sam', 'tt']) {
        const enCours   = baseActive.vehicules.find(v => v.construit !== 1 && v.construction_fin && v.construction_fin > _now && v.type === type);
        const construit = baseActive.vehicules.some(v => v.construit && v.type === type);
        const cell    = document.getElementById(`cell-${type}`);
        const overlay = document.getElementById(`overlay-${type}`);
        const check   = document.getElementById(`check-${type}`);
        if (cell) {
            cell.classList.toggle('pnv-building', !!enCours);
            cell.classList.toggle('pnv-disabled', graceOuEnCours && !enCours);
        }
        if (overlay) overlay.style.display = enCours ? 'flex' : 'none';
        if (check)   check.style.display   = (construit && !enCours) ? 'block' : 'none';
    }
}

async function _demarrerProchaineBuild() {
    const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
    if (maBase?.vehicules?.some(v => !v.construit && v.construction_fin)) return;
    const res = await fetch(`/api/joueur/${joueur_id}/construction/queue/first`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (!res || !res.ok) return;
    const data = await res.json();
    if (!data.type) return;
    if (data.type === 'jeep')   await construireJeep();
    if (data.type === 'humvet') await construireHumvet();
    if (data.type === 'sam')    await construireSam();
    if (data.type === 'tt')     await construireTT();
    _majCompteurFile();
    chargerQueueBadges();
}

function planifierActivation(vehicle) {
    const delai   = vehicle.construction_fin - Date.now();
    const finir = () => {
        const cle = _cleBaseDeVehicule(vehicle);
        activerVehicule(vehicle);
        _onConstructionTerminee(cle);
    };
    if (delai <= 0) { finir(); return; }
    setTimeout(finir, delai);
}

function planifierActivationsInitiales() {
    bases.forEach(base => {
        if (!base.vehicules) return;
        base.vehicules.forEach(v => {
            if (!v.construit && v.construction_fin) planifierActivation(v);
        });
    });
}

function labelConstruction(type) {
    const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
    if (!maBase?.vehicules) return null;
    const enCours = maBase.vehicules
        .filter(v => !v.construit && v.type === type && v.construction_fin)
        .sort((a, b) => a.construction_fin - b.construction_fin);
    if (!enCours.length) return null;
    const restant = Math.max(0, Math.ceil((enCours[0].construction_fin - Date.now()) / 1000));
    const nb = enCours.length > 1 ? ` ×${enCours.length}` : '';
    return `EN CONSTRUCTION${nb}… ${restant}s`;
}

function majBoutonVehicule() {
    _majStatutConstruction();
    majEtatVehicules();
    majIndicateurConstruction();
    _majCompteurFile();
}

// ── Indicateur de construction au-dessus du bâtiment ─────────
function _dessinerIconeBld(type) {
    const canvas = document.getElementById('bld-icon');
    if (!canvas) return;
    const ctx   = canvas.getContext('2d');
    const img   = getVehicleImg({ type });
    const frame = (type === 'tt') ? 0 : 18;
    ctx.clearRect(0, 0, 36, 36);
    if (!img.complete || !img.naturalWidth) return;
    const fw = img.naturalWidth / VEHICLE_FRAMES, fh = img.naturalHeight;
    const sc = Math.min(36 / fw, 36 / fh);
    const dw = fw * sc, dh = fh * sc;
    ctx.drawImage(img, frame * fw, 0, fw, fh, (36-dw)/2, (36-dh)/2, dw, dh);
}

function majIndicateurConstruction() {
    const el = document.getElementById('bld-indicator');
    if (!el) return;
    const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
    const now2   = Date.now();
    // Source de vérité : vehicle en cours dans le tableau (construction_fin dans le futur)
    const v = maBase?.vehicules?.find(vv => vv.construction_fin && vv.construction_fin > now2);
    if (!v) { el.style.display = 'none'; }
    else {
        const type    = v.type;
        const restant = Math.max(0, Math.ceil((v.construction_fin - now2) / 1000));
        const noms = { jeep: 'JEEP', humvet: 'HUMVET', sam: 'SAM', tt: 'TT' };
        document.getElementById('bld-name').textContent  = noms[type] ?? type.toUpperCase();
        document.getElementById('bld-timer').textContent = `⏱ ${restant}s`;
        _dessinerIconeBld(type);
        const r = typeof getNicheRect === 'function' ? getNicheRect() : null;
        if (r) {
            el.style.left    = `${r.x + r.w / 2}px`;
            el.style.top     = `${r.y - 52}px`;
            el.style.display = 'flex';
        } else { el.style.display = 'none'; }
    }

    // Indicateurs HTML des bases capturées (position seulement — DOM géré par setInterval)
    majPositionIndicateursCapturees();
}
// ── Indicateurs de construction des bases capturées ──────────
// Appelé depuis le render loop UNIQUEMENT pour la position
function majPositionIndicateursCapturees() {
    if (typeof posToMapPx === 'undefined' || typeof camX === 'undefined') return;
    bases.forEach(base => {
        if (base._neutreId == null || base.joueur_id != joueur_id) return;
        const el = document.getElementById(`bld-cap-${base._neutreId}`);
        if (!el || el.style.display === 'none') return;
        const { mx, my } = posToMapPx(base.pos_x, base.pos_y);
        el.style.left = `${mx - camX + NICHE_OFFSET_X - 60}px`;
        el.style.top  = `${my - camY + NICHE_OFFSET_Y - 60}px`;
    });
}

function _dessinerIconeCapturee(neutreId, type) {
    const ic = document.getElementById(`bld-cap-icon-${neutreId}`);
    if (!ic) return;
    const ictx  = ic.getContext('2d');
    const img   = getVehicleImg({ type });
    const frame = (type === 'tt') ? 0 : 18;
    const draw  = () => {
        ictx.clearRect(0, 0, 36, 36);
        if (!img.naturalWidth) return;
        const fw = img.naturalWidth / VEHICLE_FRAMES, fh = img.naturalHeight;
        const sc = Math.min(36/fw, 36/fh);
        ictx.drawImage(img, frame*fw, 0, fw, fh, (36-fw*sc)/2, (36-fh*sc)/2, fw*sc, fh*sc);
    };
    img.complete ? draw() : img.addEventListener('load', draw);
}

// Appelé 1×/seconde pour créer/màj/supprimer les indicateurs
function _majIndicateursBasesCapturees() {
    let conteneur = document.getElementById('bld-indicators-capturees');
    if (!conteneur) {
        conteneur = document.createElement('div');
        conteneur.id = 'bld-indicators-capturees';
        document.body.appendChild(conteneur);
    }

    bases.forEach(base => {
        if (base._neutreId == null || base.joueur_id != joueur_id) return;
        // Source de vérité : vehicle avec construction_fin dans le futur
        const vv  = base.vehicules?.find(v => v.construction_fin && v.construction_fin > Date.now());
        const id  = `bld-cap-${base._neutreId}`;
        let   el  = document.getElementById(id);

        if (!vv) {
            if (el) el.style.display = 'none';
            return;
        }

        if (!el) {
            el = document.createElement('div');
            el.id = id;
            el.style.cssText = 'position:fixed;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,0.82);border:1px solid #00c850;padding:4px 8px;pointer-events:none;z-index:150';
            el.innerHTML = `<canvas id="bld-cap-icon-${base._neutreId}" width="36" height="36"></canvas><div><div id="bld-cap-name-${base._neutreId}" style="color:#00c850;font:bold 11px monospace"></div><div id="bld-cap-timer-${base._neutreId}" style="color:#aaffcc;font:10px monospace"></div></div>`;
            conteneur.appendChild(el);
        }

        el.style.display = 'flex';

        const nameEl  = document.getElementById(`bld-cap-name-${base._neutreId}`);
        const timerEl = document.getElementById(`bld-cap-timer-${base._neutreId}`);

        // Redessiner l'icône si le type a changé
        if (nameEl && nameEl.dataset.currentType !== vv.type) {
            nameEl.dataset.currentType = vv.type;
            _dessinerIconeCapturee(base._neutreId, vv.type);
        }

        const noms = { jeep: 'JEEP', humvet: 'HUMVET', sam: 'SAM', tt: 'TT' };
        if (nameEl)  nameEl.textContent  = noms[vv.type] ?? vv.type.toUpperCase();
        if (timerEl) timerEl.textContent = `⏱ ${Math.max(0, Math.ceil((vv.construction_fin - Date.now()) / 1000))}s`;
    });
}
setInterval(_majIndicateursBasesCapturees, 1000);

function _majStatutConstruction() {
    const el = document.getElementById('pn-build-status');
    if (!el) return;
    const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
    if (!maBase?.vehicules) return;
    const enJeep   = labelConstruction('jeep');
    const enHumvet = labelConstruction('humvet');
    const enSam    = labelConstruction('sam');
    const label = enJeep ?? enHumvet ?? enSam;
    el.textContent = label ? `⚙ ${label}` : '';
    // Surbrillance de la cellule en construction
    for (const type of ['jeep','humvet','sam']) {
        const cell = document.getElementById(`cell-${type}`);
        if (cell) cell.classList.toggle('pnv-building', !!labelConstruction(type));
    }
}

function majBoutonHumvet() { _majStatutConstruction(); }
function _majBoutonHumvetOld() {
    const btn = document.getElementById('pn-btn-humvet');
    if (!btn) return;
    const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
    const count  = maBase?.vehicules?.filter(v => v.construit && v.type === 'humvet').length ?? 0;
    const cfg    = VEHICLE_CONFIG.humvet;
    const enCours = labelConstruction('humvet');
    const label = enCours ?? (count > 0 ? `🛻 HUMVET (${count} déployé(s))` : '🛻 CONSTRUIRE HUMVET');
    btn.textContent = `${label} — ⚙${cfg.cout_acier} 🪨${cfg.cout_charbon}`;
    btn.classList.remove('desactive');
    btn.onclick = () => ajouterFile('humvet');
}

function majBoutonSam() { _majStatutConstruction(); }
function _majBoutonSamOld() {
    const btn = document.getElementById('pn-btn-sam');
    if (!btn) return;
    const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
    const count  = maBase?.vehicules?.filter(v => v.construit && v.type === 'sam').length ?? 0;
    const cfg    = VEHICLE_CONFIG.sam;
    const enCours = labelConstruction('sam');
    const label   = enCours ?? (count > 0 ? `🪖 SAM (${count} déployé(s))` : '🪖 CONSTRUIRE SAM');
    btn.textContent = `${label} — ⚙${cfg.cout_acier} 🪨${cfg.cout_charbon}`;
    btn.classList.remove('desactive');
    btn.onclick = () => ajouterFile('sam');
}

setInterval(() => { majBoutonVehicule(); majBoutonHumvet(); majBoutonSam(); }, 1000);

async function construireJeep() {
    const res = await fetch(`/api/joueur/${joueur_id}/jeep/construire`, {
        method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        const data   = await res.json();
        const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
        if (maBase) {
            if (!maBase.vehicules) maBase.vehicules = [];
            const v = {
                id: data.id, type: 'jeep', construit: 0,
                construction_fin: data.construction_fin,
                x: data.jeep_x - 75, y: data.jeep_y + 75,
                cur_x: data.jeep_x, cur_y: data.jeep_y,
                _nicheX: data.jeep_x, _nicheY: data.jeep_y,
                _premiereOffset: true,
                frameIndex: 0, pv: VEHICLE_CONFIG.jeep.pv_max, lastAttack: 0, target: null
            };
            maBase.vehicules.push(v);
            planifierActivation(v);
        }
        chargerAcier(); chargerCharbon(); majBoutonVehicule();
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        if (err.erreur && err.erreur !== 'already_building') afficherMessageErreur(err.erreur);
    }
}

async function construireHumvet() {
    const res = await fetch(`/api/joueur/${joueur_id}/humvet/construire`, {
        method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        const data   = await res.json();
        const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
        if (maBase) {
            if (!maBase.vehicules) maBase.vehicules = [];
            const v = {
                id: data.id, type: 'humvet', construit: 0,
                construction_fin: data.construction_fin,
                x: data.jeep_x - 75, y: data.jeep_y + 75,
                cur_x: data.jeep_x, cur_y: data.jeep_y,
                _nicheX: data.jeep_x, _nicheY: data.jeep_y,
                _premiereOffset: true,
                frameIndex: 0, pv: VEHICLE_CONFIG.humvet.pv_max, lastAttack: 0, target: null
            };
            maBase.vehicules.push(v);
            planifierActivation(v);
        }
        chargerAcier(); chargerCharbon(); majBoutonHumvet();
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        if (err.erreur && err.erreur !== 'already_building') afficherMessageErreur(err.erreur);
    }
}

async function construireTT() {
    const res = await fetch(`/api/joueur/${joueur_id}/tt/construire`, {
        method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        const data   = await res.json();
        const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
        if (maBase) {
            if (!maBase.vehicules) maBase.vehicules = [];
            const v = {
                id: data.id, type: 'tt', construit: 0,
                construction_fin: data.construction_fin,
                x: data.jeep_x - 75, y: data.jeep_y + 75,
                cur_x: data.jeep_x, cur_y: data.jeep_y,
                _nicheX: data.jeep_x, _nicheY: data.jeep_y,
                _premiereOffset: true,
                frameIndex: 0, pv: VEHICLE_CONFIG.tt.pv_max, lastAttack: 0, target: null
            };
            maBase.vehicules.push(v);
            planifierActivation(v);
        }
        chargerAcier(); chargerCharbon(); majBoutonVehicule();
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        if (err.erreur && err.erreur !== 'already_building') afficherMessageErreur(err.erreur);
    }
}

async function construireSam() {
    const res = await fetch(`/api/joueur/${joueur_id}/sam/construire`, {
        method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        const data   = await res.json();
        const maBase = bases.find(b => b.joueur_id == joueur_id && !b._neutreId);
        if (maBase) {
            if (!maBase.vehicules) maBase.vehicules = [];
            const v = {
                id: data.id, type: 'sam', construit: 0,
                construction_fin: data.construction_fin,
                x: data.jeep_x, y: data.jeep_y,
                cur_x: data.jeep_x, cur_y: data.jeep_y,
                frameIndex: 0, pv: VEHICLE_CONFIG.sam.pv_max, lastAttack: 0, target: null
            };
            maBase.vehicules.push(v);
            planifierActivation(v);
        }
        chargerAcier(); chargerCharbon(); majBoutonSam();
    } else if (res) {
        const err = await res.json().catch(() => ({}));
        if (err.erreur && err.erreur !== 'already_building') afficherMessageErreur(err.erreur);
    }
}

// ── Panneau de construction des bases capturées ───────────────
let _baseCaptureeSelectionnee = null;
const _TYPES_BC = ['jeep', 'humvet', 'sam', 'tt'];

function ouvrirPanneauBaseCapturee(base, clickX, clickY) {
    _baseCaptureeSelectionnee = base;
    const popup = document.getElementById('popup-base-capturee');
    if (!popup) return;
    document.getElementById('pbc-titre').textContent = `${base.pseudo}`;
    const grid = document.getElementById('pbc-grid');
    grid.innerHTML = '';

    _TYPES_BC.forEach(type => {
        const cell = document.createElement('div');
        cell.style.cssText = 'background:#111;border:1px solid #333;padding:8px;cursor:pointer;text-align:center;position:relative';
        cell.innerHTML = `<canvas id="pbc-icon-${type}" width="50" height="50" style="display:block;margin:0 auto"></canvas>
            <div style="color:#ccc;font-family:'Share Tech Mono',monospace;font-size:10px;margin-top:4px">${type.toUpperCase()}</div>`;
        cell.onclick = () => construireSurBaseCapturee(type);
        grid.appendChild(cell);
    });

    // Positionner près du clic
    if (clickX != null) {
        popup.style.left      = `${Math.min(clickX + 10, window.innerWidth - 240)}px`;
        popup.style.top       = `${Math.min(clickY + 10, window.innerHeight - 200)}px`;
        popup.style.transform = 'none';
    }
    popup.style.display = 'block';

    // Dessiner les icônes
    setTimeout(() => {
        _TYPES_BC.forEach(type => {
            const c = document.getElementById(`pbc-icon-${type}`);
            if (!c) return;
            const ct = c.getContext('2d');
            const img = getVehicleImg({ type });
            if (!img.complete || !img.naturalWidth) return;
            const fw = img.naturalWidth / VEHICLE_FRAMES;
            const fh = img.naturalHeight;
            const sc = Math.min(50/fw, 50/fh);
            ct.clearRect(0, 0, 50, 50);
            ct.drawImage(img, 18*fw, 0, fw, fh, (50-fw*sc)/2, (50-fh*sc)/2, fw*sc, fh*sc);
        });
    }, 50);
}

function fermerPanneauBaseCapturee() {
    document.getElementById('popup-base-capturee').style.display = 'none';
    _baseCaptureeSelectionnee = null;
}

async function construireSurBaseCapturee(type) {
    if (!_baseCaptureeSelectionnee) return;
    const base = _baseCaptureeSelectionnee;
    const res = await fetch(`/api/joueur/${joueur_id}/base-capturee/${base._neutreId}/construire`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
    }).catch(() => null);
    if (!res) { afficherMessageErreur('Erreur réseau'); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (data.erreur !== 'already_building') afficherMessageErreur(data.erreur ?? 'Erreur');
        return;
    }

    // Créer le véhicule exactement comme la base principale
    const nicheX = data.jeep_x, nicheY = data.jeep_y;
    const v = {
        id: Number(data.id), type,
        x: nicheX - 75, y: nicheY + 75,       // cible = offset initial de sortie
        cur_x: nicheX, cur_y: nicheY,          // position courante = niche
        _nicheX: nicheX, _nicheY: nicheY,
        _premiereOffset: type !== 'sam',        // les SAMs restent sur place
        groupe_id: null, formation_slot: null,
        construction_fin: data.construction_fin,
        pv: (VEHICLE_CONFIG[type] ?? VEHICLE_CONFIG.jeep).pv_max,
        construit: 0, lastAttack: 0, target: null, frameIndex: 0
    };
    if (!base.vehicules) base.vehicules = [];
    base.vehicules.push(v);
    planifierActivation(v);
    fermerPanneauBaseCapturee();
}
