// Incolla questo blocco nel <script> del tuo index.html.
// Il server genera il cartoon solo quando apri un giocatore e lo salva in cache.

const FANTALAB_AI_URL = 'http://localhost:8787';
const artMemory = new Map();

async function getProceduralArt(p) {
  const key = `${p.name}|${p.team}`;
  if (artMemory.has(key)) return artMemory.get(key);

  const local = localStorage.getItem('fantalab-art:' + key);
  if (local) {
    artMemory.set(key, local);
    return local;
  }

  const url = `${FANTALAB_AI_URL}/api/player-art?name=${encodeURIComponent(p.name)}&team=${encodeURIComponent(p.team || '')}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  const blob = await r.blob();
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

  artMemory.set(key, dataUrl);
  try { localStorage.setItem('fantalab-art:' + key, dataUrl); } catch {}
  return dataUrl;
}

async function applyProceduralArt(p) {
  const hero = document.querySelector('#heroImg');
  if (!hero) return;
  hero.style.opacity = '.45';
  hero.alt = 'Generazione illustrazione FantaLAB…';
  try {
    const art = await getProceduralArt(p);
    hero.src = art;
  } catch (e) {
    console.error(e);
    // Lascia l'illustrazione esistente come fallback.
  } finally {
    hero.style.opacity = '1';
  }
}
