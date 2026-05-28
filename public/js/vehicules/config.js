// ── Images & constantes véhicules ────────────────────────────
const imgJeep        = new Image(); imgJeep.src        = '/assets/bases/jeep.png';
const imgHumvet      = new Image(); imgHumvet.src      = '/assets/bases/humvet.png';
const imgSam         = new Image(); imgSam.src         = '/assets/bases/sam.png';
const imgTT          = new Image(); imgTT.src          = '/assets/bases/TT.png';
const imgMitraJeep   = new Image(); imgMitraJeep.src   = '/assets/bases/mitra_jeep.png';
const imgMitraHumvet = new Image(); imgMitraHumvet.src = '/assets/bases/mitra_humvet.png';

const imgFeuMort       = new Image(); imgFeuMort.src       = '/assets/bases/feu_mort.png';
const imgBoom          = new Image(); imgBoom.src          = '/assets/bases/boom.png';
const imgVehiculeCasse = new Image(); imgVehiculeCasse.src = '/assets/bases/vehicule_casser.png';

// Stats véhicules chargées depuis public/js/constantes.js
const VEHICLE_CONFIG = VEHICULES;

const VEHICLE_SCALE       = 1;
const VEHICLE_FRAMES      = 72;
const VEHICLE_SPRITE_ROWS = 1;
const VEHICLE_SPRITE_COLS = VEHICLE_FRAMES;

// TT : même format 1 ligne × 72 frames, mais frame 0 = face droite (offset π/2 CCW)
const TT_TOTAL_FRAMES = VEHICLE_FRAMES;

const EXPLOSION_FRAMES   = 110;
const BOOM_FRAMES        = 45;
const EXPLOSION_DURATION = 3000;
const WRECK_DURATION     = 8000;

const VEHICLE_RADIUS               = 1; // rayon de collision (unités map)
const MAX_DESTRUCTIONS_PAR_SECONDE = 5;
const DISTANCE_MAX_REJOINDRE       = 500;
const GROUPE_MAX                   = 25;

const explosionSound = new Audio('/bruit/explosion_troupe.mp3');
explosionSound.volume = 0.4;
const tirJeepSound = new Audio('/bruit/tir%20jeep.mp3');
tirJeepSound.volume = 0.3;

let selectedVehicles = [];
let epaves = [];

function vcfg(v)          { return VEHICLE_CONFIG[v.type] ?? VEHICLE_CONFIG.jeep; }
function getVehicleImg(v) {
    if (v.type === 'humvet') return imgHumvet;
    if (v.type === 'sam')    return imgSam;
    if (v.type === 'tt')     return imgTT;
    return imgJeep;
}
function typeVehicule(v)  { return v.type ?? 'jeep'; }

function getVehicleSpriteSize(img) {
    img = img ?? imgJeep;
    return {
        frameWidth:  img.naturalWidth  / VEHICLE_SPRITE_COLS,
        frameHeight: img.naturalHeight / VEHICLE_SPRITE_ROWS,
    };
}

function getDirectionFrameIndex(dx, dy) {
    if (dx === 0 && dy === 0) return 0;
    const angle      = Math.atan2(dx, -dy);
    const normalized = (angle + 2 * Math.PI) % (2 * Math.PI);
    const step       = 2 * Math.PI / VEHICLE_FRAMES;
    return Math.floor((normalized + step / 2) / step) % VEHICLE_FRAMES;
}

// Vitesse de rotation : lente pour ordre joueur, rapide pour pathfinding auto
const TURN_RATE      = (2 * Math.PI / VEHICLE_FRAMES) * 0.3;  // 180° en ~2s (ordre joueur)
const TURN_RATE_AUTO = TURN_RATE * 6;                          // 180° en ~0.3s (pathfinding)

function majDirection(vehicle, vx, vy, rate = TURN_RATE) {
    const mag = Math.hypot(vx, vy);
    if (!isFinite(mag) || mag < 0.15) return;
    const target = Math.atan2(vx, -vy);
    if (vehicle._dirAngle == null) {
        vehicle._dirAngle = target;
    } else {
        let delta = target - vehicle._dirAngle;
        if (delta >  Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;
        const turn = Math.sign(delta) * Math.min(Math.abs(delta), rate);
        vehicle._dirAngle += turn;
    }
    const normalized = (vehicle._dirAngle + 2 * Math.PI) % (2 * Math.PI);
    const step = 2 * Math.PI / VEHICLE_FRAMES;
    // TT : frame 0 = est (π/2), rotation CCW → offset de π/2
    const ttShifted = vehicle.type === 'tt'
        ? (2 * Math.PI - (normalized - Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI) + step / 2)
        : null;
    const newFrame = vehicle.type === 'tt'
        ? Math.floor(ttShifted / step) % VEHICLE_FRAMES
        : Math.floor((normalized + step / 2) / step) % VEHICLE_FRAMES;
    if (vehicle.frameIndex == null) {
        vehicle.frameIndex = newFrame;
    } else if (newFrame !== vehicle.frameIndex) {
        const curCenter = ((vehicle.frameIndex * step) + 2 * Math.PI) % (2 * Math.PI);
        let diff = normalized - curCenter;
        if (diff >  Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;
        if (Math.abs(diff) > step * 0.45) vehicle.frameIndex = newFrame;
    }
}

function getVehicleScreenPos(vehicle) {
    // Afficher : véhicule construit, explosion, ou en construction avec position connue
    if (!vehicle.construit && !vehicle.explosion && vehicle.cur_x == null) return null;
    // cur_x est la position réelle affichée ; x est la cible (peut être NaN temporairement)
    const cx = isFinite(vehicle.cur_x) ? vehicle.cur_x : (isFinite(vehicle.x) ? vehicle.x : null);
    const cy = isFinite(vehicle.cur_y) ? vehicle.cur_y : (isFinite(vehicle.y) ? vehicle.y : null);
    if (cx == null || cy == null) return null;
    const { mx, my } = posToMapPx(cx, cy);
    return { sx: mx - camX, sy: my - camY };
}

function ensureBaseVehicles(base) {
    if (!base.vehicules) base.vehicules = [];
    base.vehicules.forEach(v => {
        if (v.construit == null)
            v.construit = (!v.construction_fin || Date.now() >= v.construction_fin) ? 1 : 0;
        if (v.cur_x    == null) v.cur_x = v.x;
        if (v.cur_y    == null) v.cur_y = v.y;
        if (v.frameIndex == null) v.frameIndex = 0;
        if (v.pv       == null) v.pv = vcfg(v).pv_max;
        if (v.lastAttack == null) v.lastAttack = 0;
        v.target = v.target || null;
    });
}

function ensureAllVehicles() {
    bases.forEach(ensureBaseVehicles);
}

function jouerSonExplosion() {
    const s = explosionSound.cloneNode(); s.volume = explosionSound.volume; s.play().catch(() => {});
}

function jouerSonTirJeep() {
    const s = tirJeepSound.cloneNode(); s.volume = tirJeepSound.volume; s.play().catch(() => {});
}
