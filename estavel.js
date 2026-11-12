// Estabilidade espacial — o módulo que faz o aviso parar de piscar.
//
// O PROBLEMA QUE ISTO RESOLVE. `analyzeSpatial` decide tudo quadro a quadro,
// sem memória, com limites secos: a direção pelo centro da caixa em 0,35 e
// 0,65; a faixa de distância em 2,5 m e 8,0 m. Um poste a 2,5 m da pessoa não
// fica parado no número. A caixa treme, a distância oscila entre 2,4 e 2,6, e
// a faixa dele alterna PERTO/MÉDIO várias vezes por segundo. O mesmo vale para
// um carro cujo centro passeia em volta de 0,65: ele é "à frente" num quadro e
// "à direita" no seguinte, sem ter se mexido um centímetro.
//
// São três consequências, todas sentidas por quem usa o app como visão:
//
//   1. ALERTA INTERMITENTE. O freio de repetição do AlertEngine é indexado por
//      `classe|direção`. Quando a direção alterna, a chave muda, o freio não
//      reconhece o objeto, e o MESMO poste é anunciado duas vezes — uma como
//      "à frente", outra como "à direita".
//   2. PRECISÃO DESTRUÍDA. Ouvir "à frente" e logo "à direita" sobre o mesmo
//      objeto não é informação a mais: é a informação que havia sendo apagada.
//      A direção é o dado que a pessoa usa para desviar; se ela oscila, a
//      pessoa para de confiar nela, e aí o app não serve para desviar de nada.
//   3. A CENA NUNCA SOSSEGA. `EstadoDaCena` monta a assinatura com direção e
//      faixa. Oscilando, a assinatura muda sempre, `mudou` é sempre verdadeiro,
//      e a narração nunca chega ao silêncio que foi projetada para ter.
//
// A correção é a que um termostato usa para não ligar e desligar sem parar:
// HISTERESE. Trocar de estado custa mais do que permanecer nele. E a margem é
// ASSIMÉTRICA, a favor da segurança — ficar mais perto é reconhecido no limite
// seco, na hora; ficar mais longe exige passar da margem.
//
// De quebra, o rastreio resolve um quarto defeito, este visto no teste noturno
// de 7/11: um quadro isolado classificado como "urso" virava alerta. Como a
// trilha é geométrica e não depende do rótulo, o nome do objeto passa a ser
// decidido por VOTO dos últimos quadros, e uma classificação solitária não
// manda mais na fala.
//
// Sem dependência de navegador: `node --test test/estavel.test.mjs`.

import {
  Direction, Proximity, DIST_PERTO_M, DIST_MEDIO_M, SPATIAL_DEFAULTS, caixaSa,
  FOV_VERTICAL_RAD,
} from "./core.js";

export const HISTERESE = {
  /** Fração da largura da imagem a mais para TROCAR de direção. */
  margemDirecao: 0.07,
  /** Metros a mais para declarar que o objeto se AFASTOU uma faixa. */
  margemFaixaM: 0.9,
  /** Quadros seguidos fora do corredor antes de deixar de ser "no caminho". */
  quadrosParaSair: 3,
  /** Quadros até a trilha valer como confirmada (e poder virar fala). */
  quadrosParaNascer: 2,
  /** Quanto a trilha sobrevive sem ser vista, para não renascer do zero. */
  sobrevidaMs: 900,
  /** Sobreposição mínima entre caixas para dizer "é o mesmo objeto". */
  casamentoMin: 0.2,
  /** Quantos rótulos recentes entram na votação do nome. */
  janelaDeVoto: 5,
  /** Janela para medir a deriva lateral da marcação. */
  janelaDerivaMs: 400,
  /**
   * Deriva lateral, em frações da largura da imagem por segundo, a partir da
   * qual o objeto está ESCORREGANDO PARA A BORDA — ou seja, você vai passar
   * por ele, não esbarrar nele.
   *
   * De onde vem o número: andando a 1,2 m/s, a 3 m de um carro que está 1,5 m
   * ao lado, a marcação dele gira a 0,2 rad/s ≈ 11°/s. Com o campo horizontal
   * da câmera em ~63°, isso dá 0,18 da largura por segundo. O ruído de caixa
   * do detector (±4%) produz cerca de 0,05 por segundo. 0,10 fica no meio:
   * acima do ruído, abaixo do sinal.
   */
  derivaMin: 0.10,
  /** Abaixo disto o objeto está centralizado demais para ser "de passagem". */
  desvioMin: 0.12,
  /**
   * Meia largura do corredor por onde a pessoa passa, em METROS.
   *
   * 0,60 m para cada lado dá 1,20 m de faixa livre — que não é um número
   * escolhido aqui: é a faixa livre mínima de calçada da NBR 9050. Usar a
   * mesma medida tem uma vantagem prática: o que o app chama de "no seu
   * caminho" é exatamente o que a norma chama de obstrução.
   */
  corredorM: 0.60,
  /**
   * Quanto o objeto precisa INVADIR o corredor para contar, em metros.
   *
   * Encostar não basta. A distância sai da altura da caixa, e a caixa treme:
   * medido no simulador, o tremor de ±4% desloca a borda projetada em cerca de
   * 6 cm a seis metros. Um poste cuja borda está três centímetros FORA do
   * corredor entrava e saía dele sozinho, e cada entrada valia um "Parquímetro
   * à frente" — quatro deles em dois minutos de calçada reta.
   *
   * Cinco centímetros absorvem o tremor sem esconder nada que importe: o que
   * atravanca de verdade invade o corredor aos palmos, não aos centímetros.
   */
  penetracaoMinM: 0.05,
  /** Quadros seguidos invadindo o corredor para contar como obstáculo. */
  quadrosParaEntrar: 2,
};

/** Campo horizontal da câmera, deduzido do vertical num sensor 4:3. */
export const FOV_H_RAD = 2 * Math.atan(Math.tan(FOV_VERTICAL_RAD / 2) * (4 / 3));

/**
 * O objeto atravanca o corredor por onde eu passo? Medido em METROS.
 *
 * O PROBLEMA DO TESTE ANGULAR. `analyzeSpatial` decide "no meu caminho" por
 * posição NA IMAGEM: o centro da caixa entre 0,30 e 0,70 da largura. Isso é um
 * cone, não uma faixa. A ±0,20 da largura correspondem ±12 graus, que a dois
 * metros valem 42 cm — certo — e a oito metros valem 1,70 m — completamente
 * errado. Um poste plantado a um metro do seu ombro, oito metros à frente,
 * caía dentro do "corredor" e era tratado como obstáculo no caminho.
 *
 * Medido no teste de persona: era isso que fazia "Parquímetro à frente, a oito
 * metros" sair nove vezes em dois minutos de calçada reta, para postes pelos
 * quais a pessoa ia simplesmente passar ao lado.
 *
 * Com a distância em mãos, a conta certa é trivial: projetar as bordas da
 * caixa em metros e ver se elas cruzam a faixa de 1,20 m. Sem distância, cai
 * no teste angular de antes — que é ruim, mas é o que havia.
 */
export function atravancaCorredor(box, distanciaM, {
  meiaFaixaM = HISTERESE.corredorM, penetracaoMinM = HISTERESE.penetracaoMinM,
} = {}) {
  if (!box || distanciaM == null || !Number.isFinite(distanciaM) || distanciaM <= 0) return null;
  const emMetros = (x) => distanciaM * Math.tan((x - 0.5) * FOV_H_RAD);
  const e = Math.min(emMetros(box.left), emMetros(box.right));
  const d = Math.max(emMetros(box.left), emMetros(box.right));
  // Quanto do corredor o objeto cobre, em metros.
  const invasao = Math.min(d, meiaFaixaM) - Math.max(e, -meiaFaixaM);
  return invasao >= penetracaoMinM;
}

/** Sobreposição de duas caixas normalizadas: 0 = nada em comum, 1 = idênticas. */
export function sobreposicao(a, b) {
  if (!a || !b) return 0;
  const l = Math.max(a.left, b.left);
  const r = Math.min(a.right, b.right);
  const t = Math.max(a.top, b.top);
  const bo = Math.min(a.bottom, b.bottom);
  if (r <= l || bo <= t) return 0;
  const inter = (r - l) * (bo - t);
  const areaA = (a.right - a.left) * (a.bottom - a.top);
  const areaB = (b.right - b.left) * (b.bottom - b.top);
  const uniao = areaA + areaB - inter;
  return uniao > 0 ? inter / uniao : 0;
}

/**
 * Direção com histerese. Sair da direção atual exige passar do limite MAIS a
 * margem; permanecer não exige nada. É isto que impede o objeto parado em cima
 * da fronteira de ser anunciado duas vezes, com dois nomes de lado diferentes.
 */
export function direcaoComHisterese(cx, atual, cfg = SPATIAL_DEFAULTS, margem = HISTERESE.margemDirecao) {
  const seco = cx < cfg.leftLimit ? Direction.ESQUERDA
    : cx > cfg.rightLimit ? Direction.DIREITA : Direction.FRENTE;
  if (atual == null || atual === seco) return seco;

  if (atual === Direction.FRENTE) {
    if (cx < cfg.leftLimit - margem) return Direction.ESQUERDA;
    if (cx > cfg.rightLimit + margem) return Direction.DIREITA;
    return Direction.FRENTE;
  }
  if (atual === Direction.ESQUERDA) {
    return cx > cfg.leftLimit + margem ? seco : Direction.ESQUERDA;
  }
  return cx < cfg.rightLimit - margem ? seco : Direction.DIREITA;
}

/**
 * Faixa de distância com histerese ASSIMÉTRICA.
 *
 * Aproximar vale no limite seco: se o app tem motivo para achar que algo chegou
 * perto, ele avisa agora — atrasar o aviso de aproximação é o erro que machuca.
 * Afastar exige a margem inteira, porque é justamente o "voltou para médio,
 * voltou para perto" que produz o alerta intermitente com tudo parado.
 */
export function faixaComHisterese(distanciaM, atual, margem = HISTERESE.margemFaixaM) {
  if (distanciaM == null || !Number.isFinite(distanciaM)) return atual ?? null;
  const seco = distanciaM <= DIST_PERTO_M ? Proximity.PERTO
    : distanciaM <= DIST_MEDIO_M ? Proximity.MEDIO : Proximity.LONGE;
  if (atual == null || seco <= atual) return seco;          // aproximou: na hora

  // Afastou-se: só muda se passou do limite da faixa atual mais a margem.
  if (atual === Proximity.PERTO) return distanciaM > DIST_PERTO_M + margem ? seco : Proximity.PERTO;
  if (atual === Proximity.MEDIO) return distanciaM > DIST_MEDIO_M + margem ? seco : Proximity.MEDIO;
  return seco;
}

/**
 * MARCAÇÃO CONSTANTE: o teste que marinheiro e piloto usam para saber se vão
 * colidir. O que vai te acertar permanece na mesma direção enquanto se
 * aproxima; aquilo por que você vai passar escorrega para a borda do campo de
 * visão.
 *
 * O app já invocava esta ideia, mas media a coisa errada: perguntava se o
 * objeto estava `afastando`, isto é, se a distância já tinha começado a
 * AUMENTAR. Num carro estacionado pelo qual você está passando, a distância só
 * aumenta depois que ele ficou para trás — e até lá ele passou noventa
 * segundos sendo "obstáculo perto no seu caminho", com direito a "Atenção".
 * Medido no simulador, cenário "quadra": onze "Atenção, carro à direita" e
 * oito "Atenção, parquímetro à esquerda" numa quadra em que não havia nada a
 * desviar.
 *
 * A deriva lateral vê isso segundos antes, e sem precisar de GPS: basta a
 * marcação estar se abrindo para fora do centro.
 *
 * @param historico [{ cx, ts }] do mais antigo ao mais recente
 * @returns { derivaPorS, aoLado } — `aoLado` é "você vai passar por ele"
 */
export function derivaLateral(historico, {
  janelaMs = HISTERESE.janelaDerivaMs,
  derivaMin = HISTERESE.derivaMin,
  desvioMin = HISTERESE.desvioMin,
} = {}) {
  if (!historico || historico.length < 2) return { derivaPorS: null, aoLado: false };
  const fim = historico[historico.length - 1];
  // A amostra mais antiga que ainda está dentro da janela.
  let ini = historico[0];
  for (const h of historico) { if (fim.ts - h.ts <= janelaMs) { ini = h; break; } }
  const dt = (fim.ts - ini.ts) / 1000;
  if (dt <= 0.05) return { derivaPorS: null, aoLado: false };

  // O que importa não é para que lado ele anda, e sim se está se AFASTANDO do
  // centro: um objeto à esquerda indo mais para a esquerda e um à direita indo
  // mais para a direita estão os dois saindo do caminho.
  const desvioFim = Math.abs(fim.cx - 0.5);
  const desvioIni = Math.abs(ini.cx - 0.5);
  const derivaPorS = (desvioFim - desvioIni) / dt;

  return {
    derivaPorS,
    aoLado: desvioFim >= desvioMin && derivaPorS >= derivaMin,
  };
}

/** O nome do objeto por voto dos últimos quadros, não pelo quadro de agora. */
export function rotuloVotado(historico) {
  if (!historico || historico.length === 0) return null;
  const contagem = new Map();
  for (const r of historico) contagem.set(r, (contagem.get(r) ?? 0) + 1);
  // Empate fica com o mais recente: percorremos do fim para o começo.
  let melhor = null, max = -1;
  for (let i = historico.length - 1; i >= 0; i--) {
    const c = contagem.get(historico[i]);
    if (c > max) { max = c; melhor = historico[i]; }
  }
  return melhor;
}

let proximoId = 1;

/**
 * Rastreia objetos entre quadros e devolve a mesma lista, com direção, faixa e
 * "no caminho" estabilizados, mais três campos novos:
 *
 *   trilha      — identidade estável do objeto. Vira a chave do freio de
 *                 repetição do alerta e do histórico de movimento, no lugar de
 *                 `classe|direção`, que colide entre objetos iguais e troca de
 *                 valor quando a direção treme.
 *   confirmado  — já foi visto o bastante para merecer uma frase.
 *   votos       — quantos quadros sustentam o rótulo atual.
 *
 * O casamento é GEOMÉTRICO antes de ser por rótulo, de propósito: é o que
 * permite perceber que o "urso" de um quadro e o "cachorro" do seguinte são a
 * mesma coisa, e decidir o nome por maioria em vez de por sorte.
 */
export class EstabilizadorEspacial {
  constructor(cfg = {}) {
    this.cfg = { ...HISTERESE, ...cfg };
    this.espacial = cfg.espacial ?? SPATIAL_DEFAULTS;
    this.trilhas = new Map();
  }

  reset() { this.trilhas.clear(); }

  /** Objetos vindos do analyzeSpatial. Devolve a lista estabilizada. */
  update(objects, nowMs) {
    if (!Array.isArray(objects)) return [];

    // Trilha velha demais já não explica nada: fora.
    for (const [id, t] of this.trilhas) {
      if (nowMs - t.ultimoMs > this.cfg.sobrevidaMs) this.trilhas.delete(id);
    }

    const usadas = new Set();
    const porDeteccao = new Map();

    // Objeto maior primeiro: a caixa grande é a que tem casamento confiável, e
    // atendê-la antes evita que uma caixa pequena roube a trilha dela.
    for (const o of [...objects].sort((a, b) => area(b) - area(a))) {
      const box = caixaSa(o.detection?.box);
      const id = this.#casar(o, box, usadas);
      const t = id ? this.trilhas.get(id) : null;
      porDeteccao.set(o.detection, t ? this.#aplicar(o, box, t, nowMs) : this.#nascer(o, box, nowMs));
      if (id) usadas.add(id);
    }

    // A ordem de entrada é a que o resto do app espera.
    return objects.map((o) => porDeteccao.get(o.detection) ?? o);
  }

  #casar(o, box, usadas) {
    if (!box) return null;
    const rotulo = o.detection?.label;
    let melhor = null, melhorNota = 0;
    for (const [id, t] of this.trilhas) {
      if (usadas.has(id)) continue;
      const iou = sobreposicao(box, t.box);
      if (iou < this.cfg.casamentoMin) continue;
      // Mesmo rótulo desempata a favor; rótulo diferente ainda casa, porque é
      // disso que depende a votação de nome.
      const nota = iou + (t.rotulos.includes(rotulo) ? 0.15 : 0);
      if (nota > melhorNota) { melhorNota = nota; melhor = id; }
    }
    return melhor;
  }

  #nascer(o, box, nowMs) {
    const cx = box ? (box.left + box.right) / 2 : 0.5;
    const t = {
      id: `t${proximoId++}`,
      box: box ?? { left: 0.45, right: 0.55, top: 0.45, bottom: 0.55 },
      rotulos: [o.detection?.label],
      marcacoes: [{ cx, ts: nowMs }],
      direction: direcaoComHisterese(cx, null, this.espacial, this.cfg.margemDirecao),
      proximity: o.proximity ?? null,
      inPath: false,          // um quadro só não confirma obstrução
      // O primeiro quadro já conta: "dois quadros para entrar" são dois
      // quadros desde que o objeto apareceu, não três.
      noCorredor: (atravancaCorredor(box, o.distanceM, this.cfg) ?? (o.inPath === true)) ? 1 : 0,
      foraDoCorredor: 0,
      quadros: 1,
      desdeMs: nowMs,
      ultimoMs: nowMs,
    };
    this.trilhas.set(t.id, t);
    return {
      ...o,
      direction: t.direction,
      proximity: t.proximity,
      inPath: t.inPath,
      trilha: t.id,
      confirmado: this.cfg.quadrosParaNascer <= 1,
      votos: 1,
      aoLado: false,          // um quadro só não diz para onde a marcação anda
      derivaLateral: null,
    };
  }

  #aplicar(o, box, t, nowMs) {
    if (box) t.box = box;
    const cx = (t.box.left + t.box.right) / 2;

    t.rotulos.push(o.detection?.label);
    if (t.rotulos.length > this.cfg.janelaDeVoto) t.rotulos.shift();
    const rotulo = rotuloVotado(t.rotulos);

    // Marcação: guardamos só o bastante para cobrir a janela da deriva.
    t.marcacoes.push({ cx, ts: nowMs });
    while (t.marcacoes.length > 2 && nowMs - t.marcacoes[0].ts > this.cfg.janelaDerivaMs * 2) {
      t.marcacoes.shift();
    }
    const deriva = derivaLateral(t.marcacoes, this.cfg);

    t.direction = direcaoComHisterese(cx, t.direction, this.espacial, this.cfg.margemDirecao);
    t.proximity = o.distanceM != null
      ? faixaComHisterese(o.distanceM, t.proximity, this.cfg.margemFaixaM)
      : (o.proximity ?? t.proximity);

    // "No meu caminho" medido em metros quando a distância é conhecida; no
    // ângulo da imagem só quando não é. Ver atravancaCorredor(), acima.
    const real = atravancaCorredor(t.box, o.distanceM, this.cfg);
    const noCaminho = real === null ? o.inPath === true : real;

    // Entrar exige dois quadros; sair exige três. Entrar quase na hora é
    // exigência de segurança — o que atravanca precisa ser dito cedo. Os dois
    // quadros (cerca de 170 ms) custam nada e cortam a entrada provocada pelo
    // tremor da caixa, que a margem de penetração sozinha não cobre.
    if (noCaminho) {
      t.foraDoCorredor = 0;
      if (++t.noCorredor >= this.cfg.quadrosParaEntrar) t.inPath = true;
    } else {
      t.noCorredor = 0;
      if (++t.foraDoCorredor >= this.cfg.quadrosParaSair) t.inPath = false;
    }

    t.quadros++;
    t.ultimoMs = nowMs;

    const votos = t.rotulos.filter((r) => r === rotulo).length;
    const trocouDeNome = rotulo !== o.detection?.label;
    return {
      ...o,
      // O rótulo falado é o votado. Trocar aqui, e não na hora de falar, faz a
      // correção valer para o alerta, a narração, a descrição e o diário de uma
      // vez só — e deixa `rotuloCru` para quem precisa auditar o detector.
      detection: trocouDeNome
        ? { ...o.detection, label: rotulo, rotuloCru: o.detection?.label }
        : o.detection,
      direction: t.direction,
      proximity: t.proximity,
      inPath: t.inPath,
      trilha: t.id,
      confirmado: t.quadros >= this.cfg.quadrosParaNascer && votos >= 2,
      votos,
      // "Você vai passar por isto, não vai esbarrar nisto."
      aoLado: deriva.aoLado,
      derivaLateral: deriva.derivaPorS,
    };
  }
}

function area(o) {
  const b = caixaSa(o?.detection?.box);
  return b ? (b.right - b.left) * (b.bottom - b.top) : 0;
}

/**
 * Só o que já se sustentou por quadros bastantes para virar frase.
 *
 * O alerta tem o contador próprio dele e não precisa disto. A narração e a
 * descrição precisam: são elas que anunciavam o objeto de um quadro só.
 */
export function confirmados(objects) {
  return (objects ?? []).filter((o) => o.confirmado !== false);
}
