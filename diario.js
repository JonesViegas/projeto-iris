// Projeto Íris — diário de bordo do piloto.
// Quem está validando não enxerga a tela e não tem como "tirar print".
// Sem registro objetivo, o teste vira só impressão verbal e perdemos
// o que mais importa: falso positivo e obstáculo que passou sem aviso.
//
// Nada de imagem da câmera, nada de localização, nada sai do aparelho:
// o arquivo só é gerado quando o testador toca em exportar.

const CHAVE = "iris.diario.v1";
const MAX_EVENTOS = 1200;      // cada evento vira JSON; array grande custa caro no celular
const SALVAR_CADA_MS = 5000;   // gravar a cada evento serializava tudo na thread principal

export const TipoErro = {
  FALSO_POSITIVO: "avisou_errado",
  NAO_AVISOU: "nao_avisou",
};

const agora = () => new Date().toISOString();

export class Diario {
  constructor() {
    this.sessao = null;
    this.eventos = [];
    this.ultimaMetricaMs = 0;
    this.ultimoSalvoMs = 0;
    this.sujo = false;
  }

  iniciar(extra = {}) {
    this.sessao = {
      id: `s-${Date.now().toString(36)}`,
      inicio: agora(),
      aparelho: {
        ua: navigator.userAgent,
        telaW: screen.width, telaH: screen.height,
        dpr: window.devicePixelRatio || 1,
        nucleos: navigator.hardwareConcurrency ?? null,
        memoriaGB: navigator.deviceMemory ?? null,
        idioma: navigator.language,
      },
      ...extra,
    };
    this.eventos = [];
    this.#reg("sessao_iniciada", {}, true);
    return this.sessao.id;
  }

  // `urgente` força a gravação; o resto espera a janela de tempo.
  #reg(tipo, dados, urgente = false) {
    if (!this.sessao) return;
    this.eventos.push({ t: agora(), ms: Math.round(performance.now()), tipo, ...dados });
    if (this.eventos.length > MAX_EVENTOS) this.eventos.splice(0, this.eventos.length - MAX_EVENTOS);
    this.sujo = true;
    const t = performance.now();
    if (urgente || t - this.ultimoSalvoMs >= SALVAR_CADA_MS) {
      this.ultimoSalvoMs = t;
      this.#salvar();
    }
  }

  alerta(a) { this.#reg("alerta", { texto: a.text, prioridade: a.priority, chave: a.key }); }
  piso(p) { this.#reg("piso", { superficie: p?.nome ?? null, seguro: p?.seguro ?? null, fracao: p?.fracao ?? null }); }
  obstaculo(o) { this.#reg("obstaculo_piso", { nome: o.nome, fracao: o.fracao }); }
  descricao(texto) { this.#reg("descricao", { texto }); }
  falha(onde, e) { this.#reg("falha", { onde, mensagem: String(e?.message ?? e) }); }

  /** Métrica amostrada, não por quadro: o diário é para analisar, não para encher. */
  metrica({ fps, detectionMs, segMs, objetos }, intervaloMs = 10000) {
    const t = performance.now();
    if (t - this.ultimaMetricaMs < intervaloMs) return;
    this.ultimaMetricaMs = t;
    this.#reg("metrica", {
      fps: Math.round(fps * 10) / 10,
      deteccaoMs: Math.round(detectionMs),
      segMs: segMs ?? null,
      objetos,
    });
  }

  /** O testador marcou um erro. `contexto` guarda o que o app via naquele instante. */
  erro(tipo, contexto = {}) {
    this.#reg("erro_relatado", { erroTipo: tipo, ...contexto }, true);  // o dado mais valioso do piloto
  }

  encerrar() {
    if (!this.sessao) return;
    this.#reg("sessao_encerrada", {}, true);
    this.sessao.fim = agora();
    this.#salvar();
  }

  #salvar() {
    this.sujo = false;
    try {
      localStorage.setItem(CHAVE, JSON.stringify({ sessao: this.sessao, eventos: this.eventos }));
    } catch { /* cota cheia ou modo privado: o diário é melhor-esforço, nunca derruba o app */ }
  }

  static carregar() {
    try { return JSON.parse(localStorage.getItem(CHAVE) ?? "null"); } catch { return null; }
  }

  resumo() {
    const c = (t) => this.eventos.filter((e) => e.tipo === t).length;
    const metricas = this.eventos.filter((e) => e.tipo === "metrica");
    const fpsMedio = metricas.length
      ? metricas.reduce((s, m) => s + m.fps, 0) / metricas.length : 0;
    const errados = this.eventos.filter((e) => e.tipo === "erro_relatado" && e.erroTipo === TipoErro.FALSO_POSITIVO).length;
    const perdidos = this.eventos.filter((e) => e.tipo === "erro_relatado" && e.erroTipo === TipoErro.NAO_AVISOU).length;
    return {
      alertas: c("alerta"),
      descricoes: c("descricao"),
      avisosErrados: errados,
      obstaculosPerdidos: perdidos,
      fpsMedio: Math.round(fpsMedio * 10) / 10,
      falhas: c("falha"),
      duracaoMin: this.sessao
        ? Math.round(((this.sessao.fim ? Date.parse(this.sessao.fim) : Date.now()) - Date.parse(this.sessao.inicio)) / 60000)
        : 0,
    };
  }

  /** Gera o arquivo para o testador enviar. Só acontece a pedido. */
  exportar() {
    const pacote = {
      app: "Projeto Íris",
      versao: document.querySelector('meta[name="iris-versao"]')?.content ?? "?",
      sessao: this.sessao,
      resumo: this.resumo(),
      eventos: this.eventos,
    };
    const blob = new Blob([JSON.stringify(pacote, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `iris-${this.sessao?.id ?? "sessao"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return pacote.resumo;
  }

  limpar() {
    this.eventos = [];
    this.sessao = null;
    try { localStorage.removeItem(CHAVE); } catch { /* nada a fazer */ }
  }
}
