// Orientação: onde você está, para onde está indo, e se o caminho está livre.
//
// O PROBLEMA QUE ISTO RESOLVE. O Íris sabia dizer "Você está na Rua Barão de
// Melgaço" desde a primeira versão — mas só quando a pessoa apertava o botão
// "Onde estou?". Andando, ela ouvia exclusivamente inventário de objetos:
// "Carro à direita", "Hidrante à esquerda", "Banco à frente". Um minuto de
// caminhada rendia trinta frases e nenhuma dizia em que rua ela estava, para
// que lado seguia, nem quanto faltava para chegar.
//
// Quem enxerga recebe essa camada de graça e nem percebe: a placa da esquina,
// a fachada conhecida, a calçada que continua. Sem ela, o app vira um detector
// falante — descreve coisas, não orienta ninguém.
//
// A regra de ouro aqui é o oposto da do alerta. O alerta existe para
// interromper; a orientação existe para tranquilizar. Ela é o canal mais
// baixo depois da narração, nunca atropela nada, e prefere calar a repetir.
//
// Sem dependência de navegador: `node --test test/orientar.test.mjs`.

/** Depois de iniciar, espera: a primeira orientação não atropela o começo. */
export const PRIMEIRA_MS = 6000;
/** De quanto em quanto se repete a orientação, andando. */
export const INTERVALO_ANDANDO_MS = 40000;
/** Parado, muito mais espaçado: nada mudou, não há o que orientar. */
export const INTERVALO_PARADO_MS = 90000;
/** Até onde o caminho precisa estar limpo para valer um "livre à frente". */
export const CAMINHO_LIVRE_M = 5;

/**
 * O caminho à frente está livre?
 *
 * Devolve "livre", "ocupado" ou null (sem dados para afirmar). O null é
 * importante: com a câmera desligada ou sem nenhuma detecção, o app não sabe
 * — e dizer "caminho livre" para quem não enxerga, sem saber, é pior do que
 * não dizer nada.
 *
 * @param objects saída do analyzeSpatial
 * @param vendo   se a câmera está mesmo entregando quadros
 */
export function caminhoAFrente(objects, { vendo = true, metros = CAMINHO_LIVRE_M } = {}) {
  if (!vendo || !Array.isArray(objects)) return null;
  const barra = objects.some(
    (o) => o.inPath && o.distanceM != null && o.distanceM <= metros,
  );
  return barra ? "ocupado" : "livre";
}

/** "Rua Barão de Melgaço, perto do número 200, no Centro" -> "Rua Barão de Melgaço" */
export function soAVia(endereco) {
  if (!endereco) return null;
  return String(endereco).split(",")[0].trim() || null;
}

const metrosRedondos = (m) => (m >= 100 ? Math.round(m / 10) * 10 : Math.round(m / 5) * 5);

export class Orientacao {
  constructor({
    primeiraMs = PRIMEIRA_MS,
    intervaloAndandoMs = INTERVALO_ANDANDO_MS,
    intervaloParadoMs = INTERVALO_PARADO_MS,
  } = {}) {
    Object.assign(this, { primeiraMs, intervaloAndandoMs, intervaloParadoMs });
    this.reset();
  }

  reset() {
    this.inicioMs = null;
    this.ultimaMs = null;
    this.ultimaVia = null;
    this.variante = 0;
    this.disse = false;
  }

  /** Marca o instante em que a percepção começou (base para a primeira fala). */
  iniciar(nowMs) { if (this.inicioMs === null) this.inicioMs = nowMs; }

  /**
   * ctx: {
   *   via:      "Rua Barão de Melgaço" | null
   *   cardeal:  "leste" | null
   *   destino:  "Farmácia Central" | null
   *   faltamM:  número | null
   *   andando:  bool
   *   caminho:  "livre" | "ocupado" | null
   * }
   * Devolve { texto, chave } ou null.
   */
  proxima(nowMs, ctx = {}) {
    const { via = null, cardeal = null, destino = null, faltamM = null,
            andando = false, caminho = null } = ctx;

    // Sem rua e sem destino não há orientação a dar: "caminho livre" sozinho,
    // repetido, é só mais uma frase vazia no ouvido de quem já tem demais.
    if (!via && !destino) return null;

    if (this.inicioMs === null) this.inicioMs = nowMs;
    if (nowMs - this.inicioMs < this.primeiraMs) return null;

    const mudouDeRua = Boolean(via) && this.ultimaVia !== null && via !== this.ultimaVia;

    if (!mudouDeRua && this.ultimaMs !== null) {
      const intervalo = andando ? this.intervaloAndandoMs : this.intervaloParadoMs;
      if (nowMs - this.ultimaMs < intervalo) return null;
    }

    const texto = mudouDeRua
      ? this.#mudouDeRua(via, destino, faltamM)
      : this.disse
        ? this.#curta(via, cardeal, destino, faltamM, caminho)
        : this.#completa(via, cardeal, destino, faltamM, caminho);

    if (!texto) return null;

    this.ultimaMs = nowMs;
    if (via) this.ultimaVia = via;
    this.disse = true;
    return { texto, chave: `orienta:${mudouDeRua ? "rua" : this.variante}` };
  }

  /** A primeira: forma canônica e completa, para a pessoa aprender o padrão. */
  #completa(via, cardeal, destino, faltamM, caminho) {
    const p = [];
    if (via) p.push(cardeal ? `Você está na ${via}, indo para o ${cardeal}.` : `Você está na ${via}.`);
    if (caminho === "livre") p.push("Caminho livre à frente.");
    else if (caminho === "ocupado") p.push("Tem algo no caminho à frente.");
    p.push(this.#rota(destino, faltamM));
    return p.filter(Boolean).join(" ");
  }

  /** Mudou de rua é a informação mais útil que existe: sai sozinha e inteira. */
  #mudouDeRua(via, destino, faltamM) {
    const r = this.#rota(destino, faltamM);
    return `Agora você está na ${via}.${r ? " " + r : ""}`;
  }

  /**
   * As seguintes. Curtas e em rodízio — a mesma frase a cada quarenta
   * segundos é exatamente o que fazia a pessoa desligar o som.
   */
  #curta(via, cardeal, destino, faltamM, caminho) {
    const formas = [];
    const r = this.#rota(destino, faltamM);

    if (via) formas.push(`Continua na ${via}.${r ? " " + r : ""}`);
    if (via && cardeal) formas.push(`${via}, sentido ${cardeal}.${r ? " " + r : ""}`);
    if (r && destino) formas.push(r);
    if (via && caminho === "livre") formas.push(`Caminho livre, na ${via}.`);
    if (caminho === "ocupado") formas.push("Atenção ao caminho à frente.");

    if (formas.length === 0) return null;
    this.variante = (this.variante + 1) % formas.length;
    return formas[this.variante];
  }

  /** "Faltam 120 metros até a Farmácia Central." */
  #rota(destino, faltamM) {
    if (!destino || faltamM == null || !Number.isFinite(faltamM)) return "";
    if (faltamM <= 12) return `${destino} está bem aqui, a uns ${Math.max(1, Math.round(faltamM))} metros.`;
    return `Faltam ${metrosRedondos(faltamM)} metros até ${destino}.`;
  }
}
