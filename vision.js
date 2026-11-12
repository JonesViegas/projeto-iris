// Projeto Íris — camadas que dependem do navegador.
// O núcleo em core.js continua puro e testável; tudo que toca canvas,
// vídeo ou rede mora aqui.

// ============================================================
// Cor do semáforo
// ============================================================
// Amostra os pixels mais claros dentro da caixa que o detector já achou.
// Barato: a caixa é pequena e reduzimos para no máximo 24x48.

const semCanvas = document.createElement("canvas");
const semCtx = semCanvas.getContext("2d", { willReadFrequently: true });

/**
 * @param box caixa normalizada 0..1 dentro do quadro
 * @returns [{ r, g, b, yRel }] dos pixels acesos, ou [] se a caixa for pequena demais
 */
export function amostrarSemaforo(video, box, maxLargura = 16, maxAltura = 32) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return [];

  const sx = Math.max(0, Math.floor(box.left * vw));
  const sy = Math.max(0, Math.floor(box.top * vh));
  const sw = Math.min(vw - sx, Math.ceil((box.right - box.left) * vw));
  const sh = Math.min(vh - sy, Math.ceil((box.bottom - box.top) * vh));
  if (sw < 4 || sh < 8) return [];   // longe demais para ter cor confiável

  const w = Math.min(maxLargura, sw);
  const h = Math.min(maxAltura, sh);
  semCanvas.width = w;
  semCanvas.height = h;

  try {
    semCtx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
  } catch { return []; }

  let dados;
  try { dados = semCtx.getImageData(0, 0, w, h).data; } catch { return []; }

  const px = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px.push({ r: dados[i], g: dados[i + 1], b: dados[i + 2], yRel: h === 1 ? 0.5 : y / (h - 1) });
    }
  }
  // só os 25% mais claros: o resto é carcaça preta do semáforo
  px.sort((a, b) => (b.r + b.g + b.b) - (a.r + a.g + a.b));
  return px.slice(0, Math.max(12, Math.floor(px.length * 0.25)));
}

// ============================================================
// Segmentação do piso (calçada, via, degrau, poste)
// ============================================================
// Modelo SegFormer-B0 treinado no ADE20K, versão quantizada (~4 MB).
// Roda no próprio celular, como o detector. Não é por quadro: é caro,
// então roda a cada ~1,2 s em paralelo ao laço de detecção.

const TRANSFORMERS_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";
const MODELO_SEG = "Xenova/segformer-b0-finetuned-ade-512-512";

/** Rótulos do ADE20K que nos interessam, nome -> índice usado em core.js. */
const ADE_POR_NOME = {
  floor: 3, road: 6, grass: 9, sidewalk: 11, earth: 13, fence: 32,
  railing: 38, sand: 46, path: 52, stairs: 53, stairway: 59,
  pole: 93, land: 94, step: 121,
};

/** Faixa do quadro que importa: onde os próximos passos vão cair. */
export const FAIXA_PISO = { x0: 0.25, x1: 0.75, y0: 0.60, y1: 1.0 };

const segCanvas = document.createElement("canvas");
const segCtx = segCanvas.getContext("2d", { willReadFrequently: true });

export class Segmentador {
  constructor() {
    this.pipe = null;
    this.carregando = null;   // promessa em voo: ver carregar()
    this.ocupado = false;
    this.ultimoMs = 0;
    this.erro = null;
  }

  get pronto() { return this.pipe !== null; }

  /**
   * Baixa e prepara o modelo. Chame uma vez; pode levar alguns segundos.
   *
   * A GUARDA DA PROMESSA EM VOO não é zelo: era um dos jeitos de derrubar a
   * aba. `if (this.pipe) return` só protege DEPOIS que o await terminou, e
   * entre o começo e o fim passam segundos. Quem marcasse "identificar
   * calçadas" nos ajustes com a percepção já ligada disparava uma carga; o
   * `start()` disparava outra; marcar e desmarcar duas vezes disparava mais.
   * Cada uma instanciava um SegFormer inteiro — ~120 MB — e o navegador mata
   * a aba sem evento, sem erro e sem log. Do lado de fora, isso é exatamente
   * o que o usuário relata: "liguei a calçada e o app travou".
   */
  async carregar(onProgresso) {
    if (this.pipe) return this.pipe;
    if (this.carregando) return this.carregando;   // já tem uma em voo: pegue carona
    this.carregando = (async () => {
      const mod = await import(TRANSFORMERS_URL);
      const { pipeline, env } = mod;
      this.RawImage = mod.RawImage ?? null;
      env.allowLocalModels = false;           // sempre do hub, com cache do service worker
      this.pipe = await pipeline("image-segmentation", MODELO_SEG, {
        dtype: "q8",                          // quantizado: ~4 MB em vez de 14 MB
        progress_callback: onProgresso,
      });
      return this.pipe;
    })();
    try { return await this.carregando; }
    finally { this.carregando = null; }   // falhou? a próxima tentativa pode tentar de novo
  }

  /**
   * Devolve a memória do modelo.
   *
   * O app tinha como DESLIGAR o aviso de calçada — parava o laço — e não tinha
   * como devolver os ~120 MB que o modelo ocupa. Quem experimentasse ligar e
   * desligar algumas vezes, ou desligasse a calçada para ligar o
   * reconhecimento ampliado, ficava com os dois na memória mesmo tendo
   * escolhido um. É o cenário de queda mais fácil de produzir no aparelho.
   */
  descarregar() {
    try { this.pipe?.dispose?.(); } catch { /* já foi */ }
    this.pipe = null;
    this.carregando = null;
    this.ocupado = false;
  }

  /**
   * Conta pixels por classe na faixa à frente.
   * Devolve null se o modelo ainda não carregou ou se já há uma análise rodando.
   */
  async analisar(video, faixa = FAIXA_PISO) {
    if (!this.pipe || this.ocupado) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    this.ocupado = true;
    const t0 = performance.now();
    try {
      // 384 em vez de 512: o modelo reamostra internamente e o custo cai ~40%
      const w = 384;
      const h = Math.round((vh / vw) * w);
      segCanvas.width = w;
      segCanvas.height = h;
      segCtx.drawImage(video, 0, 0, w, h);

      // toDataURL criava uma string base64 de ~100 KB por ciclo, que a
      // biblioteca decodificava de volta. Num celular isso é lixo demais
      // por segundo. RawImage pega os pixels direto do canvas.
      const entrada = this.RawImage
        ? this.RawImage.fromCanvas(segCanvas)
        : segCanvas.toDataURL("image/jpeg", 0.8);

      const saida = await this.pipe(entrada);

      const x0 = Math.floor(faixa.x0 * w), x1 = Math.ceil(faixa.x1 * w);
      const y0 = Math.floor(faixa.y0 * h), y1 = Math.ceil(faixa.y1 * h);
      const totalPixels = (x1 - x0) * (y1 - y0);
      const contagens = {};

      // passo de 2 px nos dois eixos: 4x menos iterações, mesma proporção
      const PASSO = 2;
      let amostrados = 0;
      for (const seg of saida) {
        const idx = ADE_POR_NOME[String(seg.label).split(",")[0].trim()];
        if (idx === undefined || !seg.mask) continue;
        const m = seg.mask;
        let n = 0;
        const ex = m.width / w, ey = m.height / h;
        amostrados = 0;
        for (let y = y0; y < y1; y += PASSO) {
          const my = Math.min(m.height - 1, (y * ey) | 0);
          const linha = my * m.width;
          for (let x = x0; x < x1; x += PASSO) {
            amostrados++;
            if (m.data[linha + Math.min(m.width - 1, (x * ex) | 0)] > 127) n++;
          }
        }
        if (n > 0) contagens[idx] = (contagens[idx] ?? 0) + n;
      }
      // o total precisa bater com a amostragem, senão as frações saem erradas
      const totalAmostrado = amostrados || totalPixels;

      this.ultimoMs = Math.round(performance.now() - t0);
      this.erro = null;
      return { contagens, totalPixels: totalAmostrado, ms: this.ultimoMs };
    } catch (e) {
      this.erro = e;
      console.warn("Segmentação falhou", e);
      return null;
    } finally {
      this.ocupado = false;
    }
  }
}
