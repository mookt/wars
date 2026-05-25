// ── Fonctions bruit ──────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function hash(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
}

function bruit(x, y) {
    const X = Math.floor(x), Y = Math.floor(y);
    const fx = x - X, fy = y - Y;
    const a = hash(X, Y), b = hash(X + 1, Y);
    const c = hash(X, Y + 1), d = hash(X + 1, Y + 1);
    const L = (a, b, t) => a + t * (b - a);
    return L(L(a, b, fx), L(c, d, fx), fy);
}

function octaves(x, y, oct, persist, lac) {
    let v = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < oct; i++) {
        v   += bruit(x * freq, y * freq) * amp;
        max += amp;
        amp  *= persist;
        freq *= lac;
    }
    return v / max;
}

// ── Génération du terrain ────────────────────────────────────
function setLoading(pct) {
    document.getElementById('loading-fill').style.width = pct + '%';
}

function genererTerrain() {
    return new Promise(resolve => {
        setLoading(40);
        const img = new Image();
        img.onload = () => {
            const pattern = offCtx.createPattern(img, 'repeat');
            offCtx.fillStyle = pattern;
            offCtx.fillRect(0, 0, MAP_W, MAP_H);
            setLoading(100);
            resolve();
        };
        img.onerror = () => {
            offCtx.fillStyle = '#8a7848';
            offCtx.fillRect(0, 0, MAP_W, MAP_H);
            setLoading(100);
            resolve();
        };
        img.src = '/image.png';
    });
}
