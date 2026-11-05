// Projeto Íris — leitura de texto (placas, letreiros, números de porta).
// Tesseract roda no próprio aparelho; nenhuma imagem sai daqui.
//
// OCR de câmera de celular erra muito sem preparo da imagem: o texto costuma
// vir torto, com sombra e fundo texturizado. Por isso convertemos para tons de
// cinza com contraste esticado antes de entregar ao reconhecedor, e descartamos
// o que vier com confiança baixa — falar texto errado para quem não enxerga
// é pior do que dizer que não deu para ler.

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
const IDIOMA = "por";
const LARGURA_MAX = 1280;      // acima disso o ganho some e o tempo dobra
const CONFIANCA_MIN = 55;      // média do bloco, 0..100

const lerCanvas = document.createElement("canvas");
const lerCtx = lerCanvas.getContext("2d", { willReadFrequently: true });

/** Tons de cinza com alongamento de contraste: o que mais muda o acerto do OCR. */
function prepararImagem(video) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const escala = Math.min(1, LARGURA_MAX / vw);
  const w = Math.round(vw * escala);
  const h = Math.round(vh * escala);
  lerCanvas.width = w;
  lerCanvas.height = h;
  lerCtx.drawImage(video, 0, 0, w, h);

  let img;
  try { img = lerCtx.getImageData(0, 0, w, h); } catch { return lerCanvas; }
  const d = img.data;

  // luminância e histograma
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = y;
    hist[y]++;
  }

  // corta 2% em cada ponta e estica o que sobra para 0..255
  const total = (d.length / 4) | 0;
  const corte = total * 0.02;
  let soma = 0, min = 0, max = 255;
  for (let v = 0; v < 256; v++) { soma += hist[v]; if (soma > corte) { min = v; break; } }
  soma = 0;
  for (let v = 255; v >= 0; v--) { soma += hist[v]; if (soma > corte) { max = v; break; } }
  const faixa = Math.max(1, max - min);

  for (let i = 0; i < d.length; i += 4) {
    const y = Math.max(0, Math.min(255, ((d[i] - min) * 255) / faixa));
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  lerCtx.putImageData(img, 0, 0);
  return lerCanvas;
}

/** Junta linhas, tira sujeira e devolve algo que dá para ouvir. */
export function limparTexto(bruto) {
  if (!bruto) return "";
  return bruto
    .replace(/[|¦~^`_]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      if (l.length < 2) return false;
      const letras = (l.match(/[\p{L}\p{N}]/gu) ?? []).length;
      return letras / l.length > 0.5;   // linha que é mais ruído que letra
    })
    .join(". ")
    .replace(/\s{2,}/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();
}

export class Leitor {
  constructor() {
    this.worker = null;
    this.ocupado = false;
    this.ultimoMs = 0;
  }

  get pronto() { return this.worker !== null; }

  /** Baixa o Tesseract e os dados do português (~7 MB). Uma vez só. */
  async carregar(onProgresso) {
    if (this.worker) return this.worker;
    if (!window.Tesseract) {
      await new Promise((ok, erro) => {
        const s = document.createElement("script");
        s.src = TESSERACT_URL;
        s.onload = ok;
        s.onerror = () => erro(new Error("Não foi possível baixar o leitor de texto."));
        document.head.appendChild(s);
      });
    }
    this.worker = await window.Tesseract.createWorker(IDIOMA, 1, {
      logger: onProgresso ? (m) => onProgresso(m) : undefined,
    });
    return this.worker;
  }

  /**
   * Lê o texto do quadro atual.
   * @returns { texto, confianca, ms } — `texto` vazio quando não houve leitura confiável
   */
  async ler(video) {
    if (!this.worker || this.ocupado) return null;
    this.ocupado = true;
    const t0 = performance.now();
    try {
      const img = prepararImagem(video);
      if (!img) return null;
      const { data } = await this.worker.recognize(img);
      this.ultimoMs = Math.round(performance.now() - t0);
      const texto = limparTexto(data?.text ?? "");
      const confianca = Math.round(data?.confidence ?? 0);
      if (!texto || confianca < CONFIANCA_MIN) {
        return { texto: "", confianca, ms: this.ultimoMs };
      }
      return { texto, confianca, ms: this.ultimoMs };
    } finally {
      this.ocupado = false;
    }
  }

  async encerrar() {
    try { await this.worker?.terminate(); } catch { /* já caiu */ }
    this.worker = null;
  }
}
