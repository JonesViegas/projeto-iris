// Política de fala do Íris: quem fala, quando cala, e com que palavras.
//
// O problema que este módulo resolve: com câmera, GPS e narração disparando ao
// mesmo tempo, o app vira uma metralhadora de frases iguais. Para quem enxerga,
// isso é chato. Para quem usa o app como visão, é incapacitante — a pessoa
// desliga o som, e aí não ouve o aviso que importava.
//
// Três ideias governam tudo aqui:
//   1. Canal e prioridade. Obstáculo cala navegação, que cala narração.
//   2. Validade. Informação de locomoção estraga: "vire à direita" dito três
//      segundos atrasado manda a pessoa para a esquina errada. Melhor engolir.
//   3. Variação na repetição. A primeira menção de algo é sempre na forma
//      canônica, para a pessoa aprender o padrão. Da segunda em diante muda de
//      palavra e encurta, porque repetição literal é o que cansa.
//
// Sem dependência de navegador: `node --test test/fala.test.mjs`.

import { NOMES, OBJETOS_CORTANTES, numero, metrosFalado, Verbosidade } from "./core.js";

// ---------- Canais ----------
// A ordem é a prioridade. Menor número vence.
export const Canal = {
  ALERTA: 0,      // obstáculo iminente — interrompe a locomoção
  NAVEGACAO: 1,   // manobra da rota — tem hora certa
  SISTEMA: 2,     // resposta a um toque do usuário (ele está esperando)
  DESCRICAO: 3,   // "o que tem aqui?" — longo, pode ser cortado
  NARRACAO: 4,    // ambiente em volta — o primeiro a calar
};

/** Quanto tempo uma fala ainda vale, por canal, se não puder sair na hora. */
export const VALIDADE_MS = {
  [Canal.ALERTA]: 1200,      // obstáculo some depressa: aviso velho é mentira
  [Canal.NAVEGACAO]: 2500,   // a manobra tem janela; fora dela, cala
  [Canal.SISTEMA]: 8000,     // o usuário pediu: vale a pena esperar
  [Canal.DESCRICAO]: 6000,
  [Canal.NARRACAO]: 1500,
};

/** Silêncio mínimo entre duas falas do mesmo canal. */
export const INTERVALO_MS = {
  [Canal.ALERTA]: 900,
  [Canal.NAVEGACAO]: 1500,
  [Canal.SISTEMA]: 300,
  [Canal.DESCRICAO]: 500,
  [Canal.NARRACAO]: 2200,    // folgado de propósito: narração é tempero
};

// ============================================================
// Fila de fala
// ============================================================
// Guarda no máximo UMA fala pendente por canal. Se chegar outra do mesmo canal
// antes de a primeira sair, a nova substitui a velha — em locomoção, o quadro
// de agora vale mais do que o de meio segundo atrás.

export class FilaDeFala {
  constructor({ validade = VALIDADE_MS, intervalo = INTERVALO_MS, cooldownChaveMs = 6000 } = {}) {
    this.validade = validade;
    this.intervalo = intervalo;
    this.cooldownChaveMs = cooldownChaveMs;
    this.pendentes = new Map();     // canal -> item
    this.ultimaDoCanal = new Map(); // canal -> ts da última fala emitida
    this.ultimaChave = new Map();   // chave -> ts da última fala emitida
    this.ultimoTexto = null;
    this.ultimoTs = 0;
  }

  reset() {
    this.pendentes.clear();
    this.ultimaDoCanal.clear();
    this.ultimaChave.clear();
    this.ultimoTexto = null;
    this.ultimoTs = 0;
  }

  /**
   * Oferece uma fala. Não fala nada: só registra a intenção.
   * item: { texto, canal, chave?, urgente?, validadeMs?, interrompe? }
   * Devolve true se entrou na fila.
   */
  oferecer(item, agoraMs) {
    if (!item || !item.texto) return false;
    const canal = item.canal ?? Canal.NARRACAO;

    // Mesma frase dita há pouco: engole. Este é o freio mais importante contra
    // a repetição mecânica, e vale entre canais diferentes também — navegação
    // e alerta às vezes querem dizer a mesma coisa.
    if (item.texto === this.ultimoTexto && agoraMs - this.ultimoTs < this.cooldownChaveMs) return false;

    if (item.chave) {
      const ult = this.ultimaChave.get(item.chave);
      const cd = item.urgente ? this.cooldownChaveMs / 2 : this.cooldownChaveMs;
      if (ult !== undefined && agoraMs - ult < cd) return false;
    }

    this.pendentes.set(canal, {
      ...item,
      canal,
      nascidaEm: agoraMs,
      morreEm: agoraMs + (item.validadeMs ?? this.validade[canal] ?? 2000),
    });
    return true;
  }

  /**
   * Decide o que sai agora. `falando` diz se a voz do aparelho está ocupada.
   * Devolve { texto, canal, interromper } ou null.
   */
  proxima(agoraMs, falando = false) {
    for (const [canal, it] of [...this.pendentes]) {
      if (agoraMs > it.morreEm) this.pendentes.delete(canal);
    }
    if (this.pendentes.size === 0) return null;

    const canal = [...this.pendentes.keys()].sort((a, b) => a - b)[0];
    const item = this.pendentes.get(canal);

    // O intervalo mínimo é ritmo, e ritmo cede a segurança: um alerta urgente
    // sai na hora, mesmo logo depois de outro. Meio segundo de atraso num
    // "cuidado, ônibus" é meio segundo andando na direção do ônibus.
    const urgenteDeAlerta = canal === Canal.ALERTA && item.urgente === true;
    const ult = this.ultimaDoCanal.get(canal);
    const minimo = this.intervalo[canal] ?? 1000;
    if (!urgenteDeAlerta && ult !== undefined && agoraMs - ult < minimo) return null;

    // Só alerta e navegação urgente atropelam uma fala em curso. Cortar a
    // narração no meio para dizer outra narração é o efeito metralhadora.
    const podeInterromper = canal === Canal.ALERTA
      || (canal === Canal.NAVEGACAO && item.urgente === true)
      || item.interrompe === true;
    if (falando && !podeInterromper) return null;

    this.pendentes.delete(canal);
    this.ultimaDoCanal.set(canal, agoraMs);
    if (item.chave) this.ultimaChave.set(item.chave, agoraMs);
    this.ultimoTexto = item.texto;
    this.ultimoTs = agoraMs;
    // `item` volta inteiro para quem oferecer quiser recuperar o que anexou
    // (o simulador usa isso para mostrar a prioridade real da fala emitida,
    // que pode sair vários quadros depois de ter sido oferecida).
    return { texto: item.texto, canal, interromper: podeInterromper && falando, item };
  }

  /** Descarta o que estiver pendente abaixo de um canal (um alerta chegou). */
  calarAbaixoDe(canal) {
    for (const c of [...this.pendentes.keys()]) if (c > canal) this.pendentes.delete(c);
  }
}

// ============================================================
// Fraseador
// ============================================================
// Varia a forma sem variar o fato. Regra de ouro: a PRIMEIRA vez que algo é
// dito usa sempre a forma canônica — substantivo na frente, direção, distância.
// Quem não enxerga aprende esse padrão em minutos e passa a decodificar sem
// pensar. A variação entra só a partir da segunda menção, quando a forma
// canônica já cumpriu seu papel e começa a virar ruído.

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export class Fraseador {
  constructor() {
    this.indice = new Map();   // chave do molde  -> último índice usado
    this.mencoes = new Map();  // chave do objeto -> quantas vezes já foi dito
  }

  reset() { this.indice.clear(); this.mencoes.clear(); }

  /** Quantas vezes esta coisa já foi falada (0 na primeira). */
  mencao(chave) { return this.mencoes.get(chave) ?? 0; }
  registrar(chave) { this.mencoes.set(chave, this.mencao(chave) + 1); }

  /** Esquece menções velhas: o que sumiu de cena volta a ser novidade. */
  esquecer(chave) { this.mencoes.delete(chave); }

  /** Rodízio determinístico: nunca repete a mesma variante duas vezes seguidas. */
  escolher(moldeId, variantes) {
    if (variantes.length === 0) return "";
    if (variantes.length === 1) return variantes[0];
    const ult = this.indice.get(moldeId);
    const i = ult === undefined ? 0 : (ult + 1) % variantes.length;
    this.indice.set(moldeId, i);
    return variantes[i];
  }

  /**
   * A frase de um objeto, ciente de quantas vezes ele já foi dito.
   * nome: "pessoa"; onde: "à frente"; dist: "a três metros" ou null.
   */
  objeto(chave, nome, onde, dist) {
    const n = this.mencao(chave);
    this.registrar(chave);
    const ondeQuando = dist ? `${onde}, ${dist}` : onde;

    // 1ª vez: forma canônica, sem floreio.
    if (n === 0) return `${cap(nome)} ${ondeQuando}.`;

    // 2ª vez: encurta — a pessoa já sabe o que é, quer saber se mudou.
    if (n === 1) {
      return this.escolher(`rep1:${chave}`, [
        `${cap(nome)} ainda ${ondeQuando}.`,
        `${cap(nome)} segue ${onde}${dist ? `, ${dist}` : ""}.`,
        `Continua ${nome} ${ondeQuando}.`,
      ]);
    }

    // 3ª em diante: só o essencial.
    return this.escolher(`rep2:${chave}`, [
      dist ? `${cap(nome)}, ${dist}.` : `${cap(nome)} ${onde}.`,
      `${cap(nome)} ${onde}.`,
    ]);
  }

  /** Abertura variada de descrição de ambiente. */
  aberturaDescricao() {
    return this.escolher("abertura", ["Em volta:", "À sua volta:", "No campo de visão:", "Vejo:"]);
  }
}

// ============================================================
// Agregação: uma frase, vários objetos
// ============================================================
// Dizer "Pessoa à frente." / "Carro à direita." / "Banco à esquerda." em três
// falas separadas consome seis segundos e soa a robô fazendo inventário. Uma
// frase só, agrupada por direção, informa o mesmo em dois.

const ORDEM_DIRECAO = ["à frente", "à esquerda", "à direita"];

/** "a, b e c" — com "e" antes do último, como se fala. */
export function lista(itens) {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0];
  return itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
}

/**
 * grupos: [{ nome, plural, quantidade, direcao, feminino, dist }]
 * Devolve uma frase só: "À frente, duas pessoas e um carro; à direita, um banco."
 */
export function agregar(grupos, { numero, maxDirecoes = 3, maxPorDirecao = 3 } = {}) {
  if (!grupos || grupos.length === 0) return "";

  const porDirecao = new Map();
  for (const g of grupos) {
    if (!porDirecao.has(g.direcao)) porDirecao.set(g.direcao, []);
    porDirecao.get(g.direcao).push(g);
  }

  const direcoes = [...porDirecao.keys()]
    .sort((a, b) => ORDEM_DIRECAO.indexOf(a) - ORDEM_DIRECAO.indexOf(b))
    .slice(0, maxDirecoes);

  const partes = [];
  for (const dir of direcoes) {
    // Só a primeira direção leva maiúscula: as outras vêm depois de ponto e
    // vírgula, dentro da mesma frase.
    const inicio = partes.length === 0;
    const itens = porDirecao.get(dir).slice(0, maxPorDirecao).map((g) => {
      const q = g.quantidade ?? 1;
      const palavra = q === 1 ? g.nome : (g.plural ?? g.nome);
      const contagem = numero ? numero(q, g.feminino) : String(q);
      const base = `${contagem} ${palavra}`;
      return g.dist ? `${base} ${g.dist}` : base;
    });
    partes.push(`${inicio ? cap(dir) : dir}, ${lista(itens)}`);
  }
  return partes.join("; ") + ".";
}

// ============================================================
// Estabilidade da cena
// ============================================================
// Enquanto nada muda, o melhor que o app pode fazer é ficar quieto. Esta classe
// responde a uma pergunta só: "mudou algo que valha uma frase?"

export class EstadoDaCena {
  constructor({ toleranciaMs = 1500 } = {}) {
    this.toleranciaMs = toleranciaMs;
    this.assinatura = null;
    this.desde = 0;
  }

  reset() { this.assinatura = null; this.desde = 0; }

  /**
   * objects: saída do analyzeSpatial. Devolve { mudou, estavelMs }.
   * A assinatura ignora a distância exata de propósito: ela oscila sozinha e
   * faria toda cena deixar de ser "estável" sem nada ter acontecido.
   */
  atualizar(objects, agoraMs) {
    const nova = objects
      .map((o) => `${o.detection.label}|${o.direction}|${o.proximity}|${o.approaching ? 1 : 0}`)
      .sort()
      .join(",");
    if (nova !== this.assinatura) {
      this.assinatura = nova;
      this.desde = agoraMs;
      return { mudou: true, estavelMs: 0 };
    }
    return { mudou: false, estavelMs: agoraMs - this.desde };
  }

  /** A cena está parada tempo bastante para o app calar a boca? */
  estavel(agoraMs) {
    return this.assinatura !== null && agoraMs - this.desde >= this.toleranciaMs;
  }
}

// ============================================================
// Narração do ambiente
// ============================================================
// Junta o Narrador do núcleo (que sabe o que é novidade), o Fraseador (que
// sabe não repetir) e o EstadoDaCena (que sabe quando calar) numa política só.
//
// Mora aqui, e não no app.js, porque é regra de decisão: tem de rodar sem
// navegador, no `node --test` e no simulador. Foi assim que os defeitos de
// fala das versões anteriores apareceram antes de chegar ao usuário.


const classeDe = (alvo) => String(alvo ?? "").split("|")[0];

export class NarracaoDeAmbiente {
  constructor(narrador, { fraseador = new Fraseador(), estado = new EstadoDaCena(), maxNovidades = 4 } = {}) {
    this.narrador = narrador;
    this.fraseador = fraseador;
    this.estado = estado;
    this.maxNovidades = maxNovidades;
  }

  reset() {
    this.narrador.reset();
    this.fraseador.reset();
    this.estado.reset();
  }

  /** Registre aqui o movimento da cena mesmo nos quadros em que houve alerta. */
  observar(objects, nowMs) { return this.estado.atualizar(objects, nowMs); }

  /**
   * Devolve { texto, eventos } ou null. Não marca nada como falado: quem chama
   * confirma com `confirmar()` só depois de a fila aceitar a frase. Sem essa
   * separação, uma frase descartada pela fila some para sempre — foi assim que
   * objetos nasciam calados na versão anterior.
   */
  proxima(objects, nowMs, nivel = Verbosidade.NORMAL, mudanca = null) {
    if (nivel === Verbosidade.PERIGOS) return null;
    const m = mudanca ?? this.estado.atualizar(objects, nowMs);

    // Cena parada é silêncio. Dizer de novo o que já foi dito, com as mesmas
    // palavras, é o que faz o usuário desligar o som — e quem desliga o som
    // perde junto o alerta que importava.
    if (!m.mudou && this.estado.estavel(nowMs)) return null;

    const livres = this.narrador.candidatos(objects, nowMs, nivel);
    if (livres.length === 0) return null;

    // "se aproximando" e "passando" são acontecimentos: merecem frase própria,
    // na hora. Só a lista de novidades é que vira frase única.
    const acontecimento = livres.find((c) => c.tipo !== "apareceu");
    if (acontecimento) return { texto: acontecimento.text, eventos: [acontecimento] };

    const novidades = livres.filter((c) => c.tipo === "apareceu").slice(0, this.maxNovidades);
    if (novidades.length === 0) return null;
    return this.#frasear(novidades, objects);
  }

  confirmar(eventos, nowMs) { this.narrador.confirmar(eventos, nowMs); }

  #frasear(novidades, objects) {
    // Objeto pontiagudo não entra em agregação nem em reformulação: a frase
    // hedgeada do núcleo é contratual e sai sozinha, sem dividir a atenção com
    // um banco de praça na mesma frase.
    const cortante = novidades.find((n) => OBJETOS_CORTANTES.has(classeDe(n.alvo)));
    if (cortante) return { texto: cortante.text, eventos: [cortante] };

    const achar = (alvo) => objects.find((x) => `${x.detection.label}|${x.direction}` === alvo);

    if (novidades.length === 1) {
      const n = novidades[0];
      const o = achar(n.alvo);
      const nome = o && NOMES[o.detection.label];
      if (!nome) return { texto: n.text, eventos: [n] };
      return {
        texto: this.fraseador.objeto(n.alvo, nome.singular, o.direction, metrosFalado(o.distanceM)),
        eventos: [n],
      };
    }

    const grupos = [];
    const eventos = [];
    for (const n of novidades) {
      const o = achar(n.alvo);
      const nome = o && NOMES[o.detection.label];
      if (!nome) continue;
      // A contagem é a da cena, não a das novidades: se há duas pessoas e só
      // uma é nova, dizer "uma pessoa" descreveria uma calçada que não existe.
      const quantidade = objects.filter(
        (x) => `${x.detection.label}|${x.direction}` === n.alvo).length || 1;
      grupos.push({
        nome: nome.singular, plural: nome.plural, feminino: nome.feminino,
        direcao: o.direction, quantidade,
      });
      this.fraseador.registrar(n.alvo);
      eventos.push(n);
    }
    if (grupos.length === 0) return { texto: novidades[0].text, eventos: [novidades[0]] };
    return { texto: agregar(grupos, { numero }), eventos };
  }
}
