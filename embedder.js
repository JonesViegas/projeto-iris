// Vetor de características de um quadro da câmera, para reconhecer lugares.
//
// MobileNet-V3 small via MediaPipe ImageEmbedder: ~4 MB, uns 10 a 30 ms por
// quadro num celular comum, e a mesma biblioteca que o detector já carrega —
// não entra dependência nova. Carrega só quando a pessoa usa lugares
// familiares pela primeira vez.

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODELO = "https://storage.googleapis.com/mediapipe-models/image_embedder/mobilenet_v3_small/float32/1/mobilenet_v3_small.tflite";

export class Embedder {
  constructor() {
    this.tarefa = null;
    this.carregando = null;
  }

  get pronto() { return this.tarefa !== null; }

  async carregar() {
    if (this.tarefa) return this.tarefa;
    if (this.carregando) return this.carregando;
    this.carregando = (async () => {
      const { ImageEmbedder, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
      const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
      const opcoes = (delegate) => ({
        baseOptions: { modelAssetPath: MODELO, delegate },
        runningMode: "IMAGE",
        l2Normalize: true,
        quantize: false,
      });
      try {
        this.tarefa = await ImageEmbedder.createFromOptions(fileset, opcoes("GPU"));
      } catch {
        this.tarefa = await ImageEmbedder.createFromOptions(fileset, opcoes("CPU"));
      }
      return this.tarefa;
    })();
    try { return await this.carregando; } finally { this.carregando = null; }
  }

  /** Um quadro do <video> -> Float32Array, ou null se a câmera ainda não tem imagem. */
  async vetor(video) {
    if (!video?.videoWidth) return null;
    const t = await this.carregar();
    const r = t.embed(video);
    const e = r?.embeddings?.[0];
    if (!e) return null;
    return e.floatEmbedding ? Float32Array.from(e.floatEmbedding) : null;
  }

  /** Vários quadros espaçados: a pessoa girando o celular devagar. */
  async varios(video, n = 5, intervaloMs = 350) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const v = await this.vetor(video);
      if (v) out.push(v);
      if (i < n - 1) await new Promise((r) => setTimeout(r, intervaloMs));
    }
    return out;
  }

  fechar() {
    this.tarefa?.close?.();
    this.tarefa = null;
  }
}
