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

import {
  NOMES, OBJETOS_CORTANTES, numero, metrosFalado, Verbosidade, alertaVaiCobrir,
} from "./core.js";

// ---------- Canais ----------
// A ordem é a prioridade. Menor número vence.
export const Canal = {
  ALERTA: 0,      // obstáculo iminente — interrompe a locomoção
  NAVEGACAO: 1,   // manobra da rota — tem hora certa
  SISTEMA: 2,     // resposta a um toque do usuário (ele está esperando)
  DESCRICAO: 3,   // "o que tem aqui?" — longo, pode ser cortado
  ORIENTACAO: 4,  // onde você está e quanto falta — tranquiliza, nunca interrompe
  NARRACAO: 5,    // ambiente em volta — o primeiro a calar
};

/** Quanto tempo uma fala ainda vale, por canal, se não puder sair na hora. */
export const VALIDADE_MS = {
  [Canal.ALERTA]: 1200,      // obstáculo some depressa: aviso velho é mentira
  [Canal.NAVEGACAO]: 2500,   // a manobra tem janela; fora dela, cala
  [Canal.SISTEMA]: 8000,     // o usuário pediu: vale a pena esperar
  [Canal.DESCRICAO]: 6000,
  // Orientação envelhece devagar: a rua continua sendo a mesma rua daqui a
  // cinco segundos. É a única fala do app que vale a pena esperar a voz vagar.
  [Canal.ORIENTACAO]: 5000,
  [Canal.NARRACAO]: 1500,
};

/** Silêncio mínimo entre duas falas do mesmo canal. */
export const INTERVALO_MS = {
  [Canal.ALERTA]: 900,
  [Canal.NAVEGACAO]: 1500,
  [Canal.SISTEMA]: 300,
  [Canal.DESCRICAO]: 500,
  [Canal.ORIENTACAO]: 10000, // a própria Orientacao já se espaça; isto é o teto
  [Canal.NARRACAO]: 2200,    // folgado de propósito: narração é tempero
};

// ============================================================
// Quem fala: o Íris ou o leitor de tela
// ============================================================
//
// O DEFEITO, e ele é grande: TODA pessoa cega que usar este app tem VoiceOver
// ou TalkBack ligado. É assim que ela instala o app, abre o app e acha os
// botões. E o Íris, até aqui, dizia cada frase DUAS VEZES — uma pela própria
// voz, outra pelo leitor de tela, porque `mostrar()` jogava o mesmo texto numa
// região `aria-live="assertive"`.
//
// Pior do que o eco: `assertive` manda o leitor de tela INTERROMPER o que
// estava lendo. Na prática, a pessoa não conseguia ouvir a leitura de um botão
// até o fim, porque a barra de status do app cortava a frase no meio, a cada
// aviso. O README mandava "testar com o VoiceOver ligado para ver se as vozes
// se atrapalham" — elas se atrapalhavam, e nada tratava disso.
//
// A correção é escolher UM dono para cada mensagem:
//
//   IRIS   — a voz do app diz tudo. A região viva fica calada (o texto
//            continua na tela, para quem tem baixa visão e aumenta a fonte).
//            É o padrão, porque com ele o app funciona sem leitor de tela.
//   LEITOR — o leitor de tela diz quase tudo, no ritmo e na voz que a pessoa
//            já escolheu. O Íris guarda a própria voz para o que não pode
//            esperar: obstáculo e manobra. Também aqui, cada frase tem um dono
//            só — nunca os dois.
//   AMBOS  — os dois. Serve para depurar e para quem quer redundância.
//            Produz eco: é escolha consciente, não padrão.
//
// A região viva do alerta é a única `assertive`, e no modo LEITOR ela nem
// chega a ser usada, porque o alerta sai pela voz do Íris.

export const ModoVoz = {
  IRIS: "iris",
  LEITOR: "leitor",
  AMBOS: "ambos",
};

/**
 * Quem diz esta frase?
 *
 * @returns { voz, tela, assertivo }
 *   voz       — falar pela voz do Íris (speechSynthesis)
 *   tela      — escrever na região viva (quem lê é o leitor de tela)
 *   assertivo — a região viva deve interromper a leitura em curso
 */
export function politicaDeVoz(canal, modo = ModoVoz.IRIS, { urgente = false } = {}) {
  const critico = canal === Canal.ALERTA || canal === Canal.NAVEGACAO;

  if (modo === ModoVoz.AMBOS) {
    return { voz: true, tela: true, assertivo: canal === Canal.ALERTA && urgente };
  }

  if (modo === ModoVoz.LEITOR) {
    // Obstáculo e manobra continuam na voz do Íris: a fila do leitor de tela
    // pode estar ocupada lendo um botão, e atrasar "pare" custa caro.
    if (critico) return { voz: true, tela: false, assertivo: false };
    return { voz: false, tela: true, assertivo: false };
  }

  // ModoVoz.IRIS — a voz do app é a dona. A região viva fica calada para não
  // duplicar; o texto segue visível na barra de status.
  return { voz: true, tela: false, assertivo: false };
}

// ============================================================
// Habituação: o que se repete sem consequência vira paisagem
// ============================================================
//
// O DEFEITO QUE ISTO RESOLVE, medido no simulador (cenário "quadra", 90 s de
// calçada comum): sete "Parquímetro à frente, a oito metros", seis
// "Parquímetro à esquerda, a dois metros e meio", nove "Carro passando à
// direita". São objetos fisicamente diferentes — postes a cada quinze metros,
// carros a cada seis — e por isso nenhum dos freios existentes pega: cada um é
// mesmo uma novidade. Para quem ouve, porém, é a mesma frase repetida trinta
// vezes, e é exatamente o que o usuário cego descreve como "descrever
// cumulativamente".
//
// A ideia aqui é a mais velha da percepção: HABITUAÇÃO. Quem enxerga não
// reanalisa cada poste de uma quadra; vê o padrão uma vez, guarda "há postes
// ao longo desta calçada", e só volta a olhar quando algo foge do padrão.
// Narrar poste por poste não é informação a mais — é a informação sendo
// enterrada debaixo do próprio ruído.
//
// Como funciona: cada família de frase (classe + direção + faixa) tem um
// contador. A cada repetição o silêncio exigido DOBRA. Depois de algumas
// repetições a família emudece de vez, e no lugar dela sai uma única frase de
// paisagem — "Há parquímetros ao longo da sua esquerda." — que diz o padrão em
// vez de recitar os casos.
//
// DUAS COISAS NUNCA SE HABITUAM, e são o que impede isto de virar perigoso:
//   1. Urgência. Prioridade ALTA — o que vem na sua direção ou atravanca o seu
//      caminho — passa sempre, quantas vezes for. Perigo nunca é paisagem.
//   2. Mudança de família. Carro à direita vira carro à FRENTE: família nova,
//      contador novo, fala imediata.
//
// Sem dependência de navegador: `node --test test/fala.test.mjs`.

export class Habituacao {
  constructor({
    intervaloBaseMs = 9000,     // silêncio exigido depois da primeira vez
    tetoMs = 120000,            // o silêncio dobra, mas não passa daqui
    mudoApos = 3,               // repetições até a família virar paisagem
    esquecerApos = 240000,      // sumiu de vista por tanto tempo: zera
  } = {}) {
    Object.assign(this, { intervaloBaseMs, tetoMs, mudoApos, esquecerApos });
    this.familias = new Map();   // familia -> { n, ultimoMs, paisagemDita }
  }

  reset() { this.familias.clear(); }

  /**
   * Pode falar esta família agora?
   *
   * Devolve { permite, vez, paisagem }. `paisagem` fica verdadeiro UMA vez,
   * no instante em que a família emudece: é a deixa para quem chama dizer a
   * frase do padrão em vez da frase do caso.
   */
  avaliar(familia, nowMs, { urgente = false } = {}) {
    if (!familia) return { permite: true, vez: 0, paisagem: false };
    const f = this.familias.get(familia);

    // Perigo não se habitua, e nem conta para a habituação: um carro vindo na
    // sua direção pela terceira vez na mesma quadra é a terceira vez que você
    // precisa saber.
    if (urgente) return { permite: true, vez: f?.n ?? 0, paisagem: false };

    if (!f) return { permite: true, vez: 0, paisagem: false };
    if (nowMs - f.ultimoMs > this.esquecerApos) return { permite: true, vez: 0, paisagem: false };

    if (f.n >= this.mudoApos) {
      // Emudecida. Só a primeira passagem por aqui rende a frase de paisagem.
      return { permite: false, vez: f.n, paisagem: !f.paisagemDita };
    }

    const exigido = Math.min(this.tetoMs, this.intervaloBaseMs * 2 ** (f.n - 1));
    return { permite: nowMs - f.ultimoMs >= exigido, vez: f.n, paisagem: false };
  }

  /** Falou. Só chame depois de a frase ter saído de verdade. */
  registrar(familia, nowMs, { urgente = false } = {}) {
    if (!familia) return;
    const f = this.familias.get(familia);
    // Urgente atualiza o relógio mas não acumula habituação.
    if (f && urgente) { f.ultimoMs = nowMs; return; }
    if (!f || nowMs - f.ultimoMs > this.esquecerApos) {
      this.familias.set(familia, { n: 1, ultimoMs: nowMs, paisagemDita: false });
      return;
    }
    f.n++;
    f.ultimoMs = nowMs;
  }

  /** A frase de paisagem saiu: não repetir. */
  marcarPaisagem(familia, nowMs) {
    const f = this.familias.get(familia);
    if (f) { f.paisagemDita = true; f.ultimoMs = nowMs; }
  }
}

/**
 * "Há parquímetros ao longo da sua esquerda." — a frase que substitui a
 * recitação. Diz o padrão, que é o que a pessoa precisa para construir o mapa
 * mental da calçada, e cala sobre os casos, que ela não precisa.
 */
export function frasePaisagem(plural, direcao) {
  if (!plural) return null;
  const onde = direcao === "à esquerda" ? "ao longo da sua esquerda"
    : direcao === "à direita" ? "ao longo da sua direita"
      : "ao longo do caminho";
  return `Há ${plural} ${onde}.`;
}

// ============================================================
// Fila de fala
// ============================================================
// Guarda no máximo UMA fala pendente por canal. Se chegar outra do mesmo canal
// antes de a primeira sair, a nova substitui a velha — em locomoção, o quadro
// de agora vale mais do que o de meio segundo atrás.

export class FilaDeFala {
  constructor({
    validade = VALIDADE_MS, intervalo = INTERVALO_MS, cooldownChaveMs = 6000,
    habituacao = new Habituacao(),
  } = {}) {
    this.validade = validade;
    this.intervalo = intervalo;
    this.cooldownChaveMs = cooldownChaveMs;
    this.habituacao = habituacao;
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
    this.habituacao.reset();
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

    // Habituação. Os freios acima comparam FRASES e CHAVES; este compara
    // FAMÍLIAS, e é o único que percebe que trinta postes diferentes produzem
    // a mesma notícia. Ver a classe Habituacao, acima.
    let texto = item.texto;
    let familia = item.familia ?? null;
    // `semHabituacao` é mais largo que `urgente`: cobre também o obstáculo que
    // está no caminho da pessoa mas ainda não é emergência. Ver o comentário
    // em core.js, no candidato do AlertEngine.
    const imune = item.semHabituacao === true || item.urgente === true;
    if (familia) {
      const h = this.habituacao.avaliar(familia, agoraMs, { urgente: imune });
      if (!h.permite) {
        if (!h.paisagem) return false;
        const p = frasePaisagem(item.plural, item.direcao);
        if (!p) return false;
        // A família emudeceu: no lugar do caso, o padrão — uma vez só.
        texto = p;
        this.habituacao.marcarPaisagem(familia, agoraMs);
        familia = null;   // a frase de paisagem não se habitua: ela é única
      }
    }

    this.pendentes.set(canal, {
      ...item,
      texto,
      familia,
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
    // A habituação conta frases EMITIDAS, não oferecidas: uma frase que a fila
    // engoliu nunca chegou ao ouvido e não pode contar como repetição.
    if (item.familia) {
      this.habituacao.registrar(item.familia, agoraMs, {
        urgente: item.semHabituacao === true || item.urgente === true,
      });
    }
    if (item.chave) {
      this.ultimaChave.set(item.chave, agoraMs);
      this.#podar(agoraMs);
    }
    this.ultimoTexto = item.texto;
    this.ultimoTs = agoraMs;
    // `item` volta inteiro para quem oferecer quiser recuperar o que anexou
    // (o simulador usa isso para mostrar a prioridade real da fala emitida,
    // que pode sair vários quadros depois de ter sido oferecida).
    return { texto: item.texto, canal, interromper: podeInterromper && falando, item };
  }

  /**
   * A chave de uma narração agregada combina os objetos da frase, então o
   * número de chaves possíveis cresce com as combinações da cena, não com o
   * número de classes. Numa caminhada longa isso enche o mapa sem limite.
   * Chave vencida não serve para nada: o que passou do cooldown sai.
   */
  #podar(agoraMs) {
    if (this.ultimaChave.size < 400) return;
    for (const [k, ts] of this.ultimaChave) {
      if (agoraMs - ts > this.cooldownChaveMs) this.ultimaChave.delete(k);
    }
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

    // O que o alerta vai anunciar, a narração não anuncia antes: "Semáforo à
    // frente." seguido de "Semáforo vermelho à frente." é a mesma coisa duas
    // vezes. Compara por classe e direção, que é o que as chaves carregam.
    const cobertos = new Set(objects.filter(alertaVaiCobrir)
      .map((o) => `${o.detection.label}|${o.direction}`));
    const cobre = (c) => [...cobertos].some((k) => c.chave?.endsWith(k) || c.alvo === k
      || (c.tipo === "passando" && c.chave === `passa:${k.split("|")[0]}`));
    const livres = this.narrador.candidatos(objects, nowMs, nivel).filter((c) => !cobre(c));
    if (livres.length === 0) return null;

    // "se aproximando" e "passando" são acontecimentos: merecem frase própria,
    // na hora. Só a lista de novidades é que vira frase única.
    const acontecimento = livres.find((c) => c.tipo !== "apareceu");
    if (acontecimento) {
      return {
        texto: acontecimento.text, eventos: [acontecimento],
        // "Carro passando à direita" dito nove vezes numa quadra é a mesma
        // notícia nove vezes: a família leva isso à habituação.
        familia: acontecimento.familia ?? null,
        plural: acontecimento.plural ?? null,
        direcao: acontecimento.direcao ?? null,
      };
    }

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
      const fam = { familia: n.familia ?? null, plural: n.plural ?? null, direcao: n.direcao ?? null };
      if (!nome) return { texto: n.text, eventos: [n], ...fam };
      return {
        texto: this.fraseador.objeto(n.alvo, nome.singular, o.direction, metrosFalado(o.distanceM)),
        eventos: [n],
        ...fam,
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
