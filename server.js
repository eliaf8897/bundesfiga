import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import { InferenceClient } from '@huggingface/inference';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 8787;
const HF_TOKEN = process.env.HF_TOKEN;
const CACHE_DIR = path.resolve('./fantalab-cache');
const hf = HF_TOKEN ? new InferenceClient(HF_TOKEN) : null;

const STYLE_PROMPT = `Transform the uploaded football player photo into the official FantaLAB player artwork style.
Premium hand-drawn digital sketch / cartoon illustration, semi-realistic adult footballer, bust only from chest upward, recognizable face and hairstyle preserved, clean confident expression, strong pencil and ink linework, subtle painterly shading, controlled blue/purple accent strokes, dark navy background, polished fantasy-football mobile app artwork.
Keep realistic adult proportions. Not chibi, not childish, not toy-like, not a 3D plastic character. No full body, no legs, no stadium, no ball, no text, no watermark, no sponsors, no official club logos.
The player's identity must remain recognizable. The shirt should use the club's current colors and a generic football-kit design.`;

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function getWikipediaPhoto(name) {
  const q = encodeURIComponent(name);
  const search = await fetch(`https://it.wikipedia.org/w/rest.php/v1/search/page?q=${q}&limit=3`);
  if (!search.ok) throw new Error(`Wikipedia search failed: ${search.status}`);
  const data = await search.json();
  const hit = data?.pages?.[0];
  if (!hit?.key) throw new Error('Nessuna foto Wikipedia trovata');

  const summary = await fetch(`https://it.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.key)}`);
  if (!summary.ok) throw new Error(`Wikipedia summary failed: ${summary.status}`);
  const s = await summary.json();
  const url = s?.thumbnail?.source || s?.originalimage?.source;
  if (!url) throw new Error('La pagina Wikipedia non contiene una foto');
  return { url, title: s.title || name };
}

async function getCache(file) {
  try { return await fs.readFile(path.join(CACHE_DIR, file)); } catch { return null; }
}

async function saveCache(file, buf) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(path.join(CACHE_DIR, file), buf);
}

app.get('/api/player-art', async (req, res) => {
  const name = String(req.query.name || '').trim();
  const team = String(req.query.team || '').trim();
  if (!name) return res.status(400).json({ error: 'Manca il nome del giocatore' });
  if (!hf) return res.status(500).json({ error: 'HF_TOKEN non configurato sul server' });

  const cacheKey = `${slug(name)}-${slug(team)}.png`;
  const cached = await getCache(cacheKey);
  if (cached) {
    res.set('Content-Type', 'image/png');
    res.set('X-FantaLAB-Cache', 'HIT');
    return res.send(cached);
  }

  try {
    const source = await getWikipediaPhoto(name);
    const sourceResp = await fetch(source.url);
    if (!sourceResp.ok) throw new Error(`Foto sorgente non disponibile: ${sourceResp.status}`);
    const sourceBytes = Buffer.from(await sourceResp.arrayBuffer());

    const prompt = `${STYLE_PROMPT}\nPlayer: ${name}. Club: ${team || 'professional football club'}.`;
    const output = await hf.imageTextToImage({
      model: 'black-forest-labs/FLUX.2-dev',
      provider: 'fal-ai',
      inputs: sourceBytes.toString('base64'),
      parameters: {
        prompt,
        negative_prompt: 'full body, legs, child, chibi, toy, plastic 3D, oversized head, text, watermark, logo, sponsor, stadium, ball',
        target_size: { width: 512, height: 640 },
        num_inference_steps: 28
      }
    });

    const out = Buffer.from(await output.arrayBuffer());
    await saveCache(cacheKey, out);
    res.set('Content-Type', 'image/png');
    res.set('X-FantaLAB-Cache', 'MISS');
    res.send(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || 'Generazione fallita' });
  }
});

app.listen(PORT, () => console.log(`FantaLAB AI server: http://localhost:${PORT}`));
