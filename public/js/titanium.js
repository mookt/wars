// ── Stock de titanium ──────────────────────────────────────────
let titaniumStock = 0;

async function chargerTitanium() {
    const res = await fetch(`/api/joueur/${joueur_id}/titanium`, {
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => null);
    if (res && res.ok) {
        const data = await res.json();
        titaniumStock = data.titanium ?? 0;
        majHudTitanium();
    }
}

function majHudTitanium() {
    const el = document.getElementById('hud-titanium');
    if (el) el.textContent = titaniumStock.toLocaleString('fr');
}
