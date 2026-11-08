// Ameaças — o que pode machucar a pessoa nos próximos segundos.
//
// O AlertEngine (core.js) responde "o que está perto e no caminho". Isto aqui
// responde outra pergunta: "isto é perigoso, e quanto tempo eu tenho?". A
// diferença está no tempo e na trajetória, não na classe do objeto:
//
//   - carro estacionado a 3 m não é ameaça; moto a 12 m vindo a 8 m/s é;
//   - pessoa parada a 1 m numa fila não é ameaça; pessoa vindo correndo é;
//   - degrau a 6 m é informação; degrau a 1 m com a pessoa andando é queda.
//
// Quatro famílias, cada uma com a sua regra de confirmação:
//
//   COLISÃO   veículo com tempo até o impacto curto (distância ÷ velocidade).
//   QUEDA     buraco, bueiro, degrau, escada no caminho, perto, andando.
//   PESSOA    alguém vindo depressa; alguém muito perto por muitos segundos;
//             alguém acompanhando a pessoa por mais de um minuto.
//   ARMA      possível arma de fogo. Exige confirmação em duas observações
//             independentes, e a frase é sempre "possível".
//
// Regras de linguagem, que valem mais do que os limiares:
//
//   1. Descrevemos COMPORTAMENTO, nunca intenção. "Alguém vindo depressa na
//      sua direção" é verificável; "alguém vai te assaltar" é acusação.
//   2. Nada de rosto, roupa, cor de pele, idade. Nada que identifique alguém.
//   3. Arma é sempre "possível arma de fogo". Um falso positivo dito com
//      certeza causa pânico e pode pôr um inocente em risco.
//   4. A frase diz o que FAZER quando há o que fazer: "Pare.", "Afaste-se
//      para a direita se puder." Ameaça sem orientação é só susto.
//   5. Não repete. A mesma ameaça só volta a ser dita se piorar (nível sobe,
//      distância cai de faixa) ou depois de um intervalo longo.
//
// Lógica pura, sem navegador: `node --test test/ameacas.test.mjs`.

import { VEHICLES, NOMES, metrosFalado } from "./core.js";

export const Nivel = { CRITICA: 0, ALTA: 1, MEDIA: 2 };
export const Tipo = { COLISAO: "colisao", QUEDA: "queda", PESSOA: "pessoa", ARMA: "arma", CABECA: "cabeca" };

/** Rótulo interno de arma de fogo, venha do detector próprio ou do vocabulário aberto. */
export const ROTULO_ARMA = "firearm";
/** Rótulos aceitos: o do vocabulário aberto e o do detector treinado (treino/classes.yaml). */
const ROTULOS_ARMA = new Set([ROTULO_ARMA, "arma_de_fogo"]);

// Quedas: o que faz cair, por rótulo do vocabulário aberto (ou do detector treinado).
const QUEDA = new Map([
  ["aberto:buraco", { nome: "buraco", fem: false }],
  ["aberto:bueiro aberto", { nome: "bueiro aberto", fem: false }],
  ["aberto:vala", { nome: "vala", fem: true }],
  ["aberto:degrau", { nome: "degrau", fem: false }],
  ["aberto:escada", { nome: "escada", fem: true }],
  ["aberto:escada rolante", { nome: "escada rolante", fem: true }],
  ["aberto:calçada quebrada", { nome: "calçada quebrada", fem: true }],
  ["aberto:fio caído", { nome: "fio caído", fem: false }],
  ["buraco", { nome: "buraco", fem: false }],
  ["bueiro_aberto", { nome: "bueiro aberto", fem: false }],
  ["degrau", { nome: "degrau", fem: false }],
  ["calcada_quebrada", { nome: "calçada quebrada", fem: true }],
]);
const CABECA = new Map([["aberto:galho baixo", "galho baixo"]]);

export const LIMITES = {
  ttcCriticoS: 2.5,          // abaixo disso: "Pare."
  ttcAltoS: 5,
  veiculoMovendoMs: 1.5,     // velocidade própria do veículo para contar como "vindo"
  pessoaCorrendoMs: 2.0,     // ~7 km/h: acima de caminhada rápida
  pessoaCorrendoAteM: 9,
  quedaAteM: 4,
  quedaCriticaM: 1.5,
  pertoDemaisM: 2.3,         // a estimativa satura perto (caixa cortada): 2 m já é "colado"
  pertoDemaisS: 8,
  acompanhandoAteM: 4,
  acompanhandoS: 60,
  armaJanelaMs: 25000,       // duas observações independentes dentro disto
  armaObservacoes: 2,
  armaQuadros: 4,            // ou, com detector por quadro, 4 dos últimos 6
  faixaMinMs: 2500,          // piorar de faixa só refala depois disto (o nível subir refala já)
  repetirMs: 15000,          // mesma ameaça, mesmo nível e faixa: no máximo a cada 15 s
  janelaVelocidadeMs: 1200,  // velocidade medida numa janela, não entre dois quadros
  quedaMinimaM: 1.0,         // e só conta se a distância caiu de verdade nessa janela
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nomeDe = (label) => NOMES[label]?.singular ?? label;
const femDe = (label) => NOMES[label]?.feminino === true;

/** Faixa de distância usada para decidir se a ameaça "piorou". */
function faixa(d) {
  if (d == null) return "?";
  if (d < 1.5) return "colado";
  if (d < 3) return "perto";
  if (d < 6) return "medio";
  return "longe";
}

/** Lado em linguagem de quem está andando. */
function vindoDe(direcao) {
  if (direcao === "à esquerda") return "pela esquerda";
  if (direcao === "à direita") return "pela direita";
  return "de frente";
}

/** Para onde sair do caminho: o lado oposto ao da ameaça. */
function saida(direcao) {
  if (direcao === "à esquerda") return "Afaste-se para a direita se puder.";
  if (direcao === "à direita") return "Afaste-se para a esquerda se puder.";
  return "Pare e espere.";
}

function dentro(caixa, ponto, folga = 0.15) {
  const w = caixa.right - caixa.left, h = caixa.bottom - caixa.top;
  return ponto.x >= caixa.left - w * folga && ponto.x <= caixa.right + w * folga
    && ponto.y >= caixa.top - h * folga && ponto.y <= caixa.bottom + h * folga;
}

export class AvaliadorDeAmeacas {
  constructor(limites = {}) {
    this.l = { ...LIMITES, ...limites };
    this.ditas = new Map();        // chave -> { nivel, faixa, ts }
    this.pertoDesde = null;        // pessoa muito perto: desde quando
    this.acompDesde = null;        // pessoa por perto enquanto se anda
    this.acompPerdidaMs = null;
    this.armaObs = [];             // [{ ts, varredura }]
    this.armaQuadros = [];         // últimos quadros: true/false
    this.trilhas = new Map();      // classe|direção -> [{ t, d }]
    this.classesAtivas = new Set();
  }

  /**
   * Velocidade de aproximação medida numa janela de ~1,2 s. A caixa do
   * detector treme de quadro a quadro, e a diferença entre dois quadros
   * inventa "alguém vindo depressa" com a pessoa parada. Na janela, o tremor
   * se anula; e exigimos que a distância tenha caído pelo menos 1 m.
   */
  #velocidade(o, agoraMs) {
    const k = `${o.detection.label}|${o.direction}`;
    const t = this.trilhas.get(k) ?? [];
    t.push({ t: agoraMs, d: o.distanceM });
    while (t.length && agoraMs - t[0].t > this.l.janelaVelocidadeMs) t.shift();
    this.trilhas.set(k, t);
    if (t.length < 3) return 0;
    if ((t[t.length - 1].t - t[0].t) < this.l.janelaVelocidadeMs / 2) return 0;
    // média das pontas (um terço de cada lado) para não depender de um quadro;
    // o tempo é o dos centros de cada terço, senão a velocidade sai subestimada
    const n = Math.max(1, Math.floor(t.length / 3));
    const med = (xs, f) => xs.reduce((s, x) => s + f(x), 0) / xs.length;
    const a = t.slice(0, n), b = t.slice(-n);
    const queda = med(a, (x) => x.d) - med(b, (x) => x.d);
    const dt = (med(b, (x) => x.t) - med(a, (x) => x.t)) / 1000;
    if (queda < this.l.quedaMinimaM || dt <= 0) return 0;
    return queda / dt;
  }

  reset() {
    this.ditas.clear();
    this.pertoDesde = this.acompDesde = this.acompPerdidaMs = null;
    this.armaObs = []; this.armaQuadros = [];
    this.trilhas.clear();
  }

  /**
   * objetos: saída de analyzeSpatial → MotionTracker (precisa de distanceM,
   *   direction, inPath e closingMs).
   * ctx: { velocidadeMs } — velocidade da pessoa pelo GPS (0 se parada ou sem GPS).
   * Devolve a lista de ameaças NOVAS a dizer agora, mais grave primeiro.
   * Cada uma: { nivel, tipo, chave, texto, pedirConfirmacao?, oferecerSocorro? }.
   */
  avaliar(objetos, ctx = {}, agoraMs = 0) {
    // Velocidade da pessoa: sem GPS não sabemos se ela anda. Nesse caso
    // descontamos uma caminhada (1,4 m/s) de tudo que vem de frente — senão
    // duas pessoas andando uma para a outra viram "alguém vindo depressa".
    const conhecida = Number.isFinite(ctx.velocidadeMs);
    const vPessoa = conhecida ? Math.max(0, ctx.velocidadeMs) : 0;
    const andando = vPessoa > 0.6;
    const desconto = (dir) => (dir !== "à frente" ? 0 : conhecida ? (andando ? vPessoa : 0) : 1.4);
    const candidatas = [];

    const pessoas = objetos.filter((o) => o.detection?.label === "person" && o.distanceM != null);

    for (const o of objetos) {
      const label = o.detection?.label;
      const d = o.distanceM;
      if (!label) continue;

      // ---------- colisão com veículo ----------
      if (VEHICLES.has(label) && d != null) {
        // Andando para a frente, a pessoa "fecha" a distância de tudo à frente.
        // Tiramos a velocidade dela para sobrar a do veículo.
        const fecha = this.#velocidade(o, agoraMs);
        const proprio = fecha - desconto(o.direction);
        if (proprio >= this.l.veiculoMovendoMs) {
          const ttc = d / Math.max(0.1, fecha);
          if (ttc <= this.l.ttcAltoS) {
            const critica = ttc <= this.l.ttcCriticoS;
            const nome = nomeDe(label);
            candidatas.push({
              nivel: critica ? Nivel.CRITICA : Nivel.ALTA, tipo: Tipo.COLISAO,
              chave: `colisao:${label}`, distancia: d, classe: label,
              // Curta de propósito: uma moto a 25 km/h percorre 7 m por
              // segundo. Frase longa termina com a moto já em cima.
              texto: critica
                ? `Pare. ${cap(nome)} ${vindoDe(o.direction)}.`
                : ttc > 4
                  ? `Cuidado, ${nome} vindo ${vindoDe(o.direction)}, rápido. ${saida(o.direction)}`
                  : `Cuidado, ${nome} vindo ${vindoDe(o.direction)}, rápido.`,
            });
          }
        }
        continue;
      }

      // ---------- queda ----------
      const q = QUEDA.get(label);
      if (q && d != null && d <= this.l.quedaAteM && (o.inPath || o.direction === "à frente")) {
        const critica = andando && d <= this.l.quedaCriticaM;
        candidatas.push({
          nivel: critica ? Nivel.CRITICA : Nivel.ALTA, tipo: Tipo.QUEDA,
          chave: `queda:${label}`, distancia: d, classe: label,
          texto: critica
            ? `Pare. ${cap(q.nome)} logo à frente.`
            : `Atenção, ${q.nome} ${o.direction}, ${metrosFalado(d)}. Vá devagar e confirme com a bengala.`,
        });
        continue;
      }

      // ---------- na altura da cabeça ----------
      // A bengala varre o chão; galho e placa baixa passam por cima dela.
      if (CABECA.has(label) && d != null && d <= 3 && o.inPath) {
        candidatas.push({
          nivel: Nivel.ALTA, tipo: Tipo.CABECA, chave: `cabeca:${label}`, distancia: d,
          texto: `Atenção, ${CABECA.get(label)} na altura da cabeça, ${o.direction}, ${metrosFalado(d)}.`,
        });
        continue;
      }

      // ---------- pessoa vindo depressa ----------
      if (label === "person" && d != null && d <= this.l.pessoaCorrendoAteM) {
        const propria = this.#velocidade(o, agoraMs) - desconto(o.direction);
        if (propria >= this.l.pessoaCorrendoMs) {
          candidatas.push({
            nivel: d < 3 ? Nivel.CRITICA : Nivel.ALTA, tipo: Tipo.PESSOA,
            chave: "pessoa-rapida", distancia: d, classe: "person",
            texto: d < 3
              ? `Atenção, alguém vindo depressa ${vindoDe(o.direction)}, já perto.`
              : `Atenção, alguém vindo depressa ${vindoDe(o.direction)}, ${metrosFalado(d)}.`,
          });
        }
      }
    }

    // ---------- pessoa muito perto por muito tempo ----------
    const maisPerto = pessoas.reduce((m, o) => (!m || o.distanceM < m.distanceM ? o : m), null);
    if (maisPerto && maisPerto.distanceM <= this.l.pertoDemaisM) {
      this.pertoDesde ??= agoraMs;
      if (agoraMs - this.pertoDesde >= this.l.pertoDemaisS * 1000) {
        candidatas.push({
          nivel: Nivel.MEDIA, tipo: Tipo.PESSOA, chave: "pessoa-colada", distancia: maisPerto.distanceM, classe: "person",
          texto: `Há uma pessoa muito perto de você, ${maisPerto.direction}, há alguns segundos.`,
          oferecerSocorro: true,
        });
      }
    } else {
      this.pertoDesde = null;
      this.ditas.delete("pessoa-colada");
    }

    // ---------- alguém acompanhando enquanto a pessoa anda ----------
    // A câmera olha para a frente: isto vê quem anda JUNTO, à frente ou ao
    // lado, não quem vem atrás. É uma limitação física, e o README diz isso.
    const acompanhante = pessoas.find((o) => o.distanceM <= this.l.acompanhandoAteM);
    if (andando && acompanhante) {
      this.acompDesde ??= agoraMs;
      this.acompPerdidaMs = null;
      if (agoraMs - this.acompDesde >= this.l.acompanhandoS * 1000) {
        candidatas.push({
          nivel: Nivel.MEDIA, tipo: Tipo.PESSOA, chave: "acompanhando", distancia: acompanhante.distanceM,
          texto: `Uma pessoa está andando junto com você, ${acompanhante.direction}, `
            + `${metrosFalado(acompanhante.distanceM)}, há mais de um minuto.`,
          oferecerSocorro: true,
        });
      }
    } else if (this.acompDesde !== null) {
      // Some por um quadro ou dois (oclusão, tremor): não zera de imediato.
      this.acompPerdidaMs ??= agoraMs;
      if (agoraMs - this.acompPerdidaMs > 5000) {
        this.acompDesde = this.acompPerdidaMs = null;
        this.ditas.delete("acompanhando");
      }
    }

    // ---------- possível arma de fogo ----------
    const armas = objetos.filter((o) => ROTULOS_ARMA.has(o.detection?.label));
    this.armaQuadros.push(armas.length > 0);
    if (this.armaQuadros.length > 6) this.armaQuadros.shift();
    for (const a of armas) {
      const v = a.detection.varredura;
      if (v != null && !this.armaObs.some((x) => x.varredura === v)) this.armaObs.push({ ts: agoraMs, varredura: v });
    }
    this.armaObs = this.armaObs.filter((x) => agoraMs - x.ts <= this.l.armaJanelaMs);

    if (armas.length) {
      const porVarredura = this.armaObs.length >= this.l.armaObservacoes;
      const porQuadro = armas.every((a) => a.detection.varredura == null)
        && this.armaQuadros.filter(Boolean).length >= this.l.armaQuadros;
      const a = armas[0];
      const c = { x: (a.detection.box.left + a.detection.box.right) / 2, y: (a.detection.box.top + a.detection.box.bottom) / 2 };
      const dono = pessoas.find((p) => dentro(p.detection.box, c));
      const d = dono?.distanceM ?? a.distanceM;
      const dir = dono?.direction ?? a.direction;

      if (porVarredura || porQuadro) {
        candidatas.push({
          nivel: dono ? Nivel.CRITICA : Nivel.ALTA, tipo: Tipo.ARMA, chave: "arma", distancia: d, classe: "person",
          texto: dono
            ? `Atenção. Possível arma de fogo com uma pessoa ${dir}${d != null ? `, ${metrosFalado(d)}` : ""}. `
              + "Se puder, afaste-se com calma, sem correr."
            : `Atenção. Possível arma de fogo ${dir}${d != null ? `, ${metrosFalado(d)}` : ""}.`,
          oferecerSocorro: true,
        });
      } else {
        // Uma observação só: não fala. Pede ao app uma segunda olhada já.
        candidatas.push({ nivel: Nivel.ALTA, tipo: Tipo.ARMA, chave: "arma:confirmar", texto: null, pedirConfirmacao: true });
      }
    }

    // ---------- não repetir ----------
    // Classes com ameaça em curso, dita ou não neste quadro: o alerta comum
    // não deve repetir o mesmo objeto com outras palavras enquanto ela durar.
    this.classesAtivas = new Set(candidatas.map((c) => c.classe).filter(Boolean));

    // Uma frase por vez: a mais grave que ainda tem algo novo a dizer. As
    // outras não são marcadas como ditas — esperam o próximo quadro.
    let falada = null;
    const pedidos = candidatas.filter((c) => !c.texto);
    for (const c of candidatas.filter((x) => x.texto).sort((a, b) => a.nivel - b.nivel)) {
      const antes = this.ditas.get(c.chave);
      const f = faixa(c.distancia);
      // Subir de nível refala na hora ("Cuidado" → "Pare"). Só chegar mais
      // perto, sem mudar de nível, espera um pouco: "a seis metros" e "a cinco
      // e meio" no mesmo segundo é repetição, não informação.
      const piorou = !antes || c.nivel < antes.nivel
        || (FAIXAS.indexOf(f) < FAIXAS.indexOf(antes.faixa) && agoraMs - antes.ts >= this.l.faixaMinMs);
      const venceu = antes && agoraMs - antes.ts >= this.l.repetirMs * (c.nivel === Nivel.MEDIA ? 2 : 1);
      if (!piorou && !venceu) continue;
      this.ditas.set(c.chave, { nivel: c.nivel, faixa: f, ts: agoraMs });
      // A chave que vai para a fila de fala muda quando a ameaça piora, senão
      // o freio de repetição da fila engoliria o "Pare." que vem logo depois
      // do "Cuidado.".
      falada = { ...c, chave: `${c.chave}:${c.nivel}:${f}` };
      break;
    }
    return [...(falada ? [falada] : []), ...pedidos];
  }
}

const FAIXAS = ["colado", "perto", "medio", "longe", "?"];

// ============================================================
// Pedir socorro
// ============================================================

/**
 * Texto da mensagem de socorro. Curto, com link de mapa que abre em qualquer
 * celular, e a hora — mensagem sem hora, lida meia hora depois, engana.
 */
export function mensagemDeSocorro({ lat, lng, precisaoM = null, endereco = null, motivo = null, quando = new Date() } = {}) {
  const hora = quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const partes = ["Preciso de ajuda. Mensagem enviada pelo app Íris, que uso para me orientar (sou deficiente visual)."];
  if (motivo) partes.push(`Motivo: ${motivo}.`);
  if (endereco) partes.push(`Perto de: ${endereco}.`);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    partes.push(`Minha localização às ${hora}: https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`
      + (precisaoM ? ` (precisão de uns ${Math.round(precisaoM)} m)` : ""));
  } else {
    partes.push(`Não consegui o GPS às ${hora}.`);
  }
  return partes.join(" ");
}

/** Link sms: que abre a mensagem pronta. Android usa "?body=", iPhone "&body=". */
export function linkSms(numero, texto, { ios = false } = {}) {
  const n = String(numero ?? "").replace(/[^\d+]/g, "");
  return `sms:${n}${ios ? "&" : "?"}body=${encodeURIComponent(texto)}`;
}
