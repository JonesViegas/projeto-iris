// Motor do simulador de bolso: roda a lógica REAL do Íris (navegacao.js,
// fala.js, core.js, localizar.js) em cenários sintéticos e devolve a linha
// do tempo do que a pessoa ouviria. A página só toca essa linha do tempo.
//
// Mesma ideia dos simuladores de terminal (test/simular*.mjs), mas
// determinística (ruído com semente) para que a mesma rota soe sempre igual
// e dê para comparar versões de ouvido.

import { Navegador, distanciaM, rumo } from "../navegacao.js";
import { Canal, FilaDeFala, NarracaoDeAmbiente } from "../fala.js";
import {
  analyzeSpatial, MotionTracker, AlertEngine, Narrador, Verbosidade,
  associarCortantes, Priority, ALTURA_REAL_M, FOV_VERTICAL_RAD, registrarClasses,
} from "../core.js";
import { AvaliadorDeAmeacas, Nivel, ROTULO_ARMA } from "../ameacas.js";
import { interpretarComando, Acao, AJUDA_FALADA } from "../conversa.js";

// Os rótulos do vocabulário aberto que as cenas usam (o app registra todos
// a partir de aberto.js, que precisa de navegador).
registrarClasses({
  nomes: { "aberto:degrau": { singular: "degrau", plural: "degraus", feminino: false } },
  alturas: { "aberto:degrau": 0.18, [ROTULO_ARMA]: 0.2 },
  alerta: ["aberto:degrau"],
});
import {
  enderecoFalado, selecionarReferencias, fraseOndeEstou, fraseOndeEstouDeNovo,
} from "../localizar.js";

// ---------------- utilidades ----------------
function aleatorio(semente) {
  let x = semente % 2147483647 || 1;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
}
const P = (lat, lng) => ({ lat, lng });
const BASE = P(-15.5989, -56.0949);   // centro de Cuiabá
const mover = (p, dn, de) => P(p.lat + dn / 111320, p.lng + de / (111320 * Math.cos(p.lat * Math.PI / 180)));
function aoLongo(a, b, m) {
  const t = Math.min(1, m / Math.max(0.001, distanciaM(a, b)));
  return P(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
}
const trecho = (a, b, instrucao, via) => ({ instrucao, via, distanciaM: distanciaM(a, b), inicio: a, fim: b, polilinha: [a, b] });
const duracaoDaFala = (t) => 350 + (t.length / 16) * 1000;

// ---------------- rotas ----------------
function rotaEmL() {
  const a = BASE, b = mover(a, 0, 180), c = mover(b, 140, 0);
  return {
    destino: { nome: "Farmácia Central", ...c }, distanciaM: 320, duracaoS: 270,
    passos: [
      trecho(a, b, "Siga pela Rua Barão de Melgaço", "Rua Barão de Melgaço"),
      trecho(b, c, "Vire à esquerda na Avenida Getúlio Vargas", "Avenida Getúlio Vargas"),
    ],
  };
}
function rotaComTravessia() {
  const a = BASE, b = mover(a, 0, 90), c = mover(b, 0, 14), d = mover(c, 0, 120);
  return {
    destino: { nome: "Ponto de ônibus da praça", ...d }, distanciaM: 224, duracaoS: 190,
    passos: [
      trecho(a, b, "Siga pela Rua Pedro Celestino", "Rua Pedro Celestino"),
      trecho(b, c, "Atravesse a Rua Comandante Costa", "Rua Comandante Costa"),
      trecho(c, d, "Siga pela Rua Pedro Celestino", "Rua Pedro Celestino"),
    ],
  };
}

function simularRota({ rota, bussola = true, semCurso = false, precisaoM = 6, desviar = false,
  rumoInicial = null, semente = 7 }) {
  const r = rota();
  const nav = new Navegador();
  const fila = new FilaDeFala();
  const rnd = aleatorio(semente);
  const linhas = [];
  let falandoAte = 0;

  const ini = nav.iniciar(r);
  fila.oferecer({ texto: ini.texto, canal: Canal.NAVEGACAO, chave: ini.chave, validadeMs: 20000 }, 0);

  const pernas = r.passos.map((p) => [p.inicio, p.fim]);
  if (desviar) { const e = r.passos[0].fim; pernas[1] = [e, mover(e, 0, 70)]; }

  let ts = 0;
  const escoar = (metros, nota) => {
    const s = fila.proxima(ts, ts < falandoAte);
    if (s) {
      falandoAte = ts + duracaoDaFala(s.texto);
      linhas.push({ t: ts / 1000, metros, texto: s.texto, tipo: s.item.urgente ? "agora" : "aviso", nota });
    }
  };

  // Fase parada: a pessoa gira até alinhar (só com bússola e rumo inicial errado).
  if (bussola && rumoInicial != null) {
    const alvo = rumo(r.passos[0].inicio, r.passos[0].fim);
    let h = rumoInicial;
    for (let i = 0; i < 40 && nav.alinhamento !== "feito"; i++) {
      for (const ev of nav.atualizar({ ...r.passos[0].inicio, precisaoM, velocidadeMs: 0 }, h, ts)) {
        if (ev.texto) fila.oferecer({ texto: ev.texto, canal: Canal.NAVEGACAO, chave: ev.chave, urgente: ev.urgente }, ts);
      }
      escoar(0, i === 0 ? null : `girando… virado para ${Math.round(((h % 360) + 360) % 360)}°`);
      // gira 12° por segundo na direção certa, depois de 2 s de hesitação
      if (i >= 2) {
        const d = ((alvo - h + 540) % 360) - 180;
        h += Math.sign(d) * Math.min(Math.abs(d), 12);
      }
      ts += 1000;
    }
  }

  let perna = 0, andado = 0, feito = 0;
  while (perna < pernas.length && ts < 420000) {
    const [a, b] = pernas[perna];
    const comp = distanciaM(a, b);
    if (andado > comp) { feito += comp; perna++; andado = 0; continue; }
    const verdade = aoLongo(a, b, andado);
    const ang = rnd() * Math.PI * 2, raio = rnd() * precisaoM * 0.6;
    const lido = { ...mover(verdade, Math.cos(ang) * raio, Math.sin(ang) * raio), precisaoM };
    const rr = rumo(a, b);
    for (const ev of nav.atualizar({ ...lido, velocidadeMs: 1.2, rumoGraus: semCurso ? null : rr }, bussola ? rr : null, ts)) {
      if (ev.texto) fila.oferecer({ texto: ev.texto, canal: Canal.NAVEGACAO, chave: ev.chave, urgente: ev.urgente }, ts);
    }
    escoar(Math.round(feito + andado));
    if (!nav.ativo) break;
    andado += 1.2;
    ts += 1000;
  }
  return linhas;
}

// ---------------- cenas da câmera ----------------
function caixaA(label, metros, cx = 0.5, larguraRel = 0.45) {
  const H = ALTURA_REAL_M[label] ?? 1.0;
  let h = Math.min(0.96, H / (2 * metros * Math.tan(FOV_VERTICAL_RAD / 2)));
  const w = h * larguraRel, top = Math.max(0.02, 0.55 - h / 2);
  return { left: Math.max(0, cx - w / 2), right: Math.min(1, cx + w / 2), top, bottom: Math.min(0.98, top + h) };
}
const det = (label, metros, cx, lr) => ({ label, score: 0.9, box: caixaA(label, metros, cx, lr) });

function simularCena({ duracaoS, quadro, semente = 3, velocidadeMs = 0 }) {
  const rnd = aleatorio(semente);
  const motion = new MotionTracker(), alerts = new AlertEngine();
  const avaliador = new AvaliadorDeAmeacas();
  const ambiente = new NarracaoDeAmbiente(new Narrador());
  const fila = new FilaDeFala();
  const linhas = [];
  let falandoAte = 0;
  const FPS = 12;
  for (let i = 0; i < duracaoS * FPS; i++) {
    const ts = (i * 1000) / FPS, t = ts / 1000;
    const dets = quadro(t).map((d) => {
      const j = () => (rnd() - 0.5) * 0.08 * (d.box.bottom - d.box.top);
      const dy = j();
      return { ...d, box: { left: Math.max(0, d.box.left + j()), right: Math.min(1, d.box.right + j()),
        top: Math.max(0, d.box.top + dy), bottom: Math.min(1, d.box.bottom + dy) } };
    });
    let objs = associarCortantes(motion.update(analyzeSpatial(dets), ts));
    for (const o of objs) { const orig = dets.find((d) => d.label === o.detection.label); if (orig?.cor) o.cor = orig.cor; }
    const mudanca = ambiente.observar(objs, ts);
    const ameaca = avaliador.avaliar(objs, { velocidadeMs }, ts).find((x) => x.texto);
    for (const c of avaliador.classesAtivas) alerts.silenciar(c, ts + 1500);
    if (ameaca) {
      fila.calarAbaixoDe(Canal.ALERTA);
      fila.oferecer({ texto: ameaca.texto, canal: Canal.ALERTA, chave: ameaca.chave, urgente: true, ameaca: true }, ts);
      if (ameaca.classe) alerts.silenciar(ameaca.classe, ts + 5000);
      if (ameaca.oferecerSocorro) fila.oferecer({ texto: "Se precisar de ajuda, segure o botão de socorro.", canal: Canal.SISTEMA, chave: "sos" }, ts);
    }
    const a = ameaca ? null : alerts.process(objs, ts);
    if (ameaca) { /* a ameaça já ocupou a voz */ } else if (a) {
      fila.calarAbaixoDe(Canal.ALERTA);
      fila.oferecer({ texto: a.text, canal: Canal.ALERTA, chave: a.key, urgente: a.priority === Priority.ALTA }, ts);
    } else {
      const fala = ambiente.proxima(objs, ts, Verbosidade.NORMAL, mudanca);
      if (fala && fila.oferecer({ texto: fala.texto, canal: Canal.NARRACAO, chave: fala.eventos.map((e) => e.chave).join("+") }, ts)) {
        ambiente.confirmar(fala.eventos, ts);
      }
    }
    const s = fila.proxima(ts, ts < falandoAte);
    if (s) {
      falandoAte = ts + duracaoDaFala(s.texto);
      linhas.push({ t, texto: s.texto,
        tipo: s.item.ameaca ? "ameaca" : s.canal === Canal.ALERTA ? "alerta" : s.canal === Canal.SISTEMA ? "aviso" : "ambiente" });
    }
  }
  return linhas;
}

// ---------------- onde estou ----------------
function simularOndeEstou() {
  const aqui = { ...BASE, precisaoM: 9 };
  const n = (m) => BASE.lat + m / 111320;
  const l = (m) => BASE.lng + m / (111320 * Math.cos(BASE.lat * Math.PI / 180));
  const elementos = [
    { lat: n(20), lon: BASE.lng, tags: { highway: "crossing", tactile_paving: "yes" } },
    { lat: BASE.lat, lon: l(15), tags: { amenity: "pharmacy", name: "Pague Menos" } },
    { lat: n(-40), lon: BASE.lng, tags: { highway: "bus_stop" } },
    { lat: n(30), lon: l(-25), tags: { shop: "bakery", name: "Pão de Mel" } },
  ];
  const endereco = enderecoFalado({ road: "Rua Barão de Melgaço", house_number: "2154", suburb: "Centro Norte" });
  const estado = (rumoPessoa, pos = aqui, ts = 0) => ({
    endereco, rumoPessoa, pos, precisaoM: pos.precisaoM, ts, familiar: null,
    referencias: selecionarReferencias(elementos, pos, rumoPessoa),
  });
  const e1 = estado(0);
  const e2 = estado(5, aqui, 30000);
  const e3 = estado(90, aqui, 60000);
  const andou = { ...mover(BASE, 0, -30), precisaoM: 9 };
  const e4 = estado(90, andou, 120000);
  return [
    { t: 0, texto: fraseOndeEstou({ ...e1 }), tipo: "aviso", nota: "1º toque: parado, virado para o norte" },
    { t: 30, texto: fraseOndeEstouDeNovo(e1, e2), tipo: "aviso", nota: "2º toque, 30 s depois, no mesmo lugar" },
    { t: 60, texto: fraseOndeEstouDeNovo(e2, e3), tipo: "aviso", nota: "3º toque, depois de girar para o leste" },
    { t: 120, texto: fraseOndeEstouDeNovo(e3, e4), tipo: "aviso", nota: "4º toque, depois de andar 30 m" },
    { t: 150, texto: fraseOndeEstou({ ...estado(null), precisaoM: 70 }), tipo: "aviso", nota: "Outro dia: sem bússola e com GPS fraco" },
  ];
}

// ---------------- conversa por voz ----------------
// O que cada frase dita vira: a interpretação é a real (conversa.js). As
// respostas da IA de visão não são simuladas — dependem da foto — e aparecem
// marcadas como tal.
function simularConversa() {
  const onde = simularOndeEstou()[0].texto;
  let ultima = null;
  const resposta = (falado) => {
    const c = interpretarComando(falado);
    switch (c.acao) {
      case Acao.ONDE_ESTOU: return { texto: onde, nota: "comando: resolvido no aparelho" };
      case Acao.DESCREVER: return { texto: "À frente, uma mesa e duas cadeiras; à direita, uma porta.", nota: "comando: descrição do aparelho (cena de exemplo)" };
      case Acao.LER: return { texto: "Lendo. \"Farmácia Popular. Aberto até as 22 horas.\"", nota: "comando: leitura de texto do aparelho (placa de exemplo)" };
      case Acao.IR: return { texto: `Procurando o caminho até ${c.destino}.`, nota: `comando: navegação até "${c.destino}"` };
      case Acao.REPETIR: return { texto: ultima, nota: "comando: repete a última fala importante" };
      case Acao.AJUDA: return { texto: AJUDA_FALADA, nota: "comando: ajuda" };
      case Acao.SOCORRO: return { texto: "Pedindo socorro. Pegando a sua localização.", nota: "comando: SOS" };
      default: return {
        texto: "Para perguntas livres sobre a imagem, ligue a descrição detalhada nos ajustes. Por enquanto, digo o que vejo.",
        nota: "pergunta livre: com a descrição detalhada ligada, a IA de visão olha a foto e responde aqui",
      };
    }
  };
  const falas = ["Onde eu estou?", "O que tem na minha frente?", "Lê isso pra mim", "Me leva até a farmácia",
    "Essa nota é de quanto?", "Repete", "Quais são os comandos?"];
  const linhas = [];
  let t = 0;
  for (const f of falas) {
    linhas.push({ t, texto: f, tipo: "voce" });
    const r = resposta(f);
    ultima = r.texto;
    linhas.push({ t: t + 1, texto: r.texto, tipo: "aviso", nota: r.nota });
    t += 15;
  }
  return linhas;
}

// ---------------- catálogo ----------------
export const CENARIOS = [
  { id: "voz", grupo: "Situar", titulo: "Conversa por voz",
    resumo: "A pessoa toca em Perguntar e fala. Comandos conhecidos resolvem no aparelho, sem internet; perguntas livres vão à IA de visão.",
    gerar: simularConversa },
  { id: "alinhar", grupo: "Andar", titulo: "Virado para o lado errado",
    resumo: "Parado na calçada, de costas para o caminho. O app guia o giro e confirma quando acerta.",
    gerar: () => simularRota({ rota: rotaEmL, rumoInicial: 270 }) },
  { id: "esquina", grupo: "Andar", titulo: "Rota com uma esquina",
    resumo: "180 m, vira à esquerda, mais 140 m. Confirma o caminho nos trechos longos.",
    gerar: () => simularRota({ rota: rotaEmL }) },
  { id: "travessia", grupo: "Andar", titulo: "Travessia de rua",
    resumo: "O app manda parar e devolve a decisão. Nunca diz que pode atravessar.",
    gerar: () => simularRota({ rota: rotaComTravessia }) },
  { id: "desvio", grupo: "Andar", titulo: "Passou da esquina",
    resumo: "A pessoa segue reto em vez de virar. O app diz para que lado a rota ficou.",
    gerar: () => simularRota({ rota: rotaEmL, desviar: true }) },
  { id: "sem-bussola", grupo: "Andar", titulo: "Sem bússola",
    resumo: "Sem saber o rumo, o app usa pontos cardeais e nunca diz esquerda ou direita.",
    gerar: () => simularRota({ rota: rotaEmL, bussola: false, semCurso: true }) },
  { id: "onde-estou", grupo: "Situar", titulo: "Onde estou? (quatro toques)",
    resumo: "A primeira resposta é completa. As seguintes dizem só o que mudou.",
    gerar: simularOndeEstou },
  { id: "calcada", grupo: "Câmera", titulo: "Calçada com gente vindo",
    resumo: "Carro estacionado à direita, banco à esquerda, uma pessoa se aproximando de frente.",
    gerar: () => simularCena({ duracaoS: 12, quadro: (t) => [
      det("car", 6, 0.86, 0.9), det("person", Math.max(1.2, 9 - t * 0.9), 0.5), det("bench", 7, 0.2, 1.2)] }) },
  { id: "mesa", grupo: "Câmera", titulo: "Objetos sobre a mesa",
    resumo: "Quatro objetos parados. Uma frase só, e depois silêncio enquanto nada muda.",
    gerar: () => simularCena({ duracaoS: 12, quadro: () => [
      det("cup", 0.9, 0.35), det("cell phone", 0.8, 0.55), det("bottle", 1.1, 0.72), det("book", 1.0, 0.2)] }) },
  { id: "moto", grupo: "Ameaças", titulo: "Moto vindo rápido",
    resumo: "Uma moto cruza pela direita a uns 25 km/h. O app calcula o tempo até o impacto e manda parar.",
    gerar: () => simularCena({ duracaoS: 6, quadro: (t) => [det("motorcycle", Math.max(2, 22 - t * 7), 0.82, 1.1)] }) },
  { id: "correndo", grupo: "Ameaças", titulo: "Alguém correndo na sua direção",
    resumo: "Uma pessoa vem correndo de frente. O app descreve o que acontece, sem acusar ninguém.",
    gerar: () => simularCena({ duracaoS: 5, quadro: (t) => [det("person", Math.max(1.2, 12 - t * 3.8), 0.5)] }) },
  { id: "colado", grupo: "Ameaças", titulo: "Pessoa muito perto, parada",
    resumo: "Alguém fica a um metro por muitos segundos. Um aviso só, e a dica do botão de socorro.",
    gerar: () => simularCena({ duracaoS: 16, quadro: () => [det("person", 1.0, 0.55)] }) },
  { id: "degrau", grupo: "Ameaças", titulo: "Degrau no caminho",
    resumo: "Andando em direção a um degrau. Primeiro atenção, depois pare.",
    gerar: () => simularCena({ duracaoS: 4, velocidadeMs: 1.2,
      quadro: (t) => [det("aberto:degrau", Math.max(0.8, 4 - t * 1.2), 0.5, 4)] }) },
  { id: "arma", grupo: "Ameaças", titulo: "Possível arma de fogo",
    resumo: "Primeira varredura vê algo parecido com arma: o app cala e olha de novo. Só fala depois de confirmar, e sempre como possível.",
    gerar: () => simularCena({ duracaoS: 9, quadro: (t) => {
      const p = det("person", 4, 0.5);
      const pb = p.box;
      const mao = { left: pb.left + (pb.right - pb.left) * 0.6, right: pb.left + (pb.right - pb.left) * 0.85,
        top: pb.top + (pb.bottom - pb.top) * 0.45, bottom: pb.top + (pb.bottom - pb.top) * 0.58 };
      const l = [p];
      // 1ª varredura em t=1 s; segunda olhada (pedida pelo app) em t=3,5 s
      if (t >= 1) l.push({ label: ROTULO_ARMA, score: 0.3, box: mao, varredura: t >= 3.5 ? 2 : 1 });
      return l;
    } }) },
  { id: "esquina-camera", grupo: "Câmera", titulo: "Semáforo e ônibus",
    resumo: "Semáforo muda de vermelho para verde e um ônibus cruza.",
    gerar: () => simularCena({ duracaoS: 12, quadro: (t) => {
      const l = [{ ...det("traffic light", 7, 0.55, 0.35), cor: t < 6 ? "vermelho" : "verde" }];
      if (t > 2 && t < 8) l.push(det("bus", Math.max(4, 22 - t * 2.2), 0.3, 2.4));
      return l;
    } }) },
];
