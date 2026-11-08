// Projeto Íris — percepção do ambiente no navegador.
// Detecção de objetos (MediaPipe + EfficientDet-Lite0), segmentação do piso
// (SegFormer-B0 / ADE20K) e leitura de texto (Tesseract) rodando no próprio
// aparelho. Nenhuma imagem sai daqui.

import {
  analyzeSpatial, AlertEngine, describeScene, Priority, Proximity, NOMES,
  MotionTracker, corDoSemaforo, analisarPiso, obstaculosDoPiso, avisoDePiso,
  Narrador, Verbosidade, associarCortantes, registrarClasses, numero,
} from "./core.js";
import { amostrarSemaforo, Segmentador } from "./vision.js";
import { Leitor } from "./ocr.js";
import { Diario, TipoErro } from "./diario.js";
import { Canal, FilaDeFala, Fraseador, EstadoDaCena, NarracaoDeAmbiente } from "./fala.js";
import { Navegador, referenciaNoLado, distanciaFalada, cardeal, distanciaM } from "./navegacao.js";
import { Orientacao, caminhoAFrente, soAVia } from "./orientar.js";
import { tracarRota } from "./rotas.js";
import { RastreadorDePosicao, Bussola, ditarDestino, ouvirFala } from "./posicao.js";
import { interpretarComando, Acao, Conversa, AJUDA_FALADA } from "./conversa.js";
import {
  DetectorAberto, nomesDoVocabulario, rotulosDeRisco, ALTURAS_ABERTAS, VOCABULARIO,
  consultasDeAmeaca,
} from "./aberto.js";
import { DescritorNaNuvem, contextoLocal, AVISO_DE_CONSENTIMENTO } from "./nuvem.js";
import {
  barramento, Evento, registroDeRisco, buscarEmProvedores, registrarProvedorDeLugares,
} from "./integracao.js";
import { ondeEstou as consultarOndeEstou, reverso, enderecoFalado } from "./localizar.js";
import { MemoriaDeLugares, ArmazemIndexedDB } from "./lugares.js";
import { Embedder } from "./embedder.js";
import { AvaliadorDeAmeacas, Nivel, mensagemDeSocorro, linkSms } from "./ameacas.js";

// As classes de vocabulário aberto passam a existir para todo o núcleo:
// ganham nome flexionado, altura para a estimativa de distância e, as de
// risco alto, direito a alerta falado na hora.
registrarClasses({
  nomes: nomesDoVocabulario(),
  alturas: ALTURAS_ABERTAS,
  alerta: [...rotulosDeRisco()],
});

const MP_VERSION = "0.10.14";
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
// Lite2 acerta bem mais que o Lite0 (mAP ~33 contra ~26) ao custo de 12 MB
// em vez de 7 MB. O Lite0 fica como opcao para aparelho fraco.
const MODELOS = {
  lite2: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite",
  lite0: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
};
const SCORE_MIN = 0.50;   // abaixo disso o Lite0 inventava objeto demais
const MAX_FPS = 12;
const DESCRIBE_FRAMES = 4;
const SEG_INTERVALO_MS = 2000;
const SEG_COOLDOWN_MS = 6000;

const $ = (id) => document.getElementById(id);
const video = $("camera");
const overlay = $("overlay");
const ctx = overlay.getContext("2d");
const btnToggle = $("toggle");
const btnDescrever = $("descrever");
const btnLerTexto = $("lerTexto");
const rotuloPrincipal = $("rotuloPrincipal");
const statusEl = $("status");
const extraEl = $("extra");
const falaEl = $("fala");
const metricsEl = $("metrics");
const pisoEl = $("piso");
const liveEl = $("live");
const dlgAjustes = $("ajustes");

let state = "parado"; // parado | carregando | ativo
let detector = null;
let stream = null;
let rafId = 0;
let segTimer = 0;
let wakeLock = null;
let lastTs = 0;
let lastFrameAt = 0;
let fps = 0;
let describeLeft = 0;
let describeBuffer = [];
let ultimosObjetos = [];
let pisoAtual = null;
let pisoAnterior = null;
let segIntervaloAtual = SEG_INTERVALO_MS;
let lendoTexto = false;
const ultimoAvisoPiso = new Map();

const alerts = new AlertEngine();
const motion = new MotionTracker();
const orientacao = new Orientacao();
const narrador = new Narrador();
const segmentador = new Segmentador();
const leitor = new Leitor();
const diario = new Diario();

// A fila é a única porta de saída da voz. Antes, alerta, narração e descrição
// chamavam speak() direto e brigavam entre si; agora cada um oferece a sua
// frase e a fila decide quem fala, quem espera e quem é engolido.
const fila = new FilaDeFala();
const fraseador = new Fraseador();
const estadoCena = new EstadoDaCena();
// A política de narração mora em fala.js, não aqui: ela precisa rodar sem
// navegador, no `node --test` e no simulador.
const ambiente = new NarracaoDeAmbiente(narrador, { fraseador, estado: estadoCena });

// Navegação a pé
const navegador = new Navegador();
const rastreador = new RastreadorDePosicao({
  aoMover: (p) => aoMoverPosicao(p),
  aoFalhar: (e) => { dizer(e.message, Canal.SISTEMA, { chave: "nav:gps-erro" }); },
});
// Alinhamento antes de sair: parado, o GPS quase não manda leitura nova, e é
// a bússola girando que precisa acordar o navegador ("isso, siga em frente").
let ultimoGiroMs = 0;
const bussola = new Bussola({
  aoGirar: () => {
    const agora = performance.now();
    if (agora - ultimoGiroMs < 250) return;
    ultimoGiroMs = agora;
    if (navegador.ativo && navegador.alinhamento !== "feito" && rastreador.ultima) {
      aoMoverPosicao({ ...rastreador.ultima, velocidadeMs: 0 });
    }
  },
});
let rotaAtual = null;
let destinoAtual = "";
let recalculando = false;

// Vocabulário aberto e descrição na nuvem
const detectorAberto = new DetectorAberto();
const nuvem = new DescritorNaNuvem();
let varreduraTimer = 0;
let riscosAbertos = [];          // detecções abertas ainda válidas
let riscosAteMs = 0;

// "Onde estou?" e lugares familiares
const memoriaLugares = new MemoriaDeLugares({
  armazem: typeof indexedDB !== "undefined" ? new ArmazemIndexedDB() : null,
});
const embedder = new Embedder();
let localizando = false;
let ultimoOndeEstou = null;   // para a segunda pergunta dizer só o que mudou
let memorizando = false;
// Quando o "Onde estou?" dispara a descrição, a frase do lugar abre a fala da
// câmera — numa fala só, para a segunda não engolir a primeira na fila.
let prefixoDescricao = null;

// Ameaças e socorro
const avaliador = new AvaliadorDeAmeacas();
let idVarredura = 0;            // cada varredura aberta é uma observação independente
let confirmandoAmeaca = false;
let ultimaConfirmacaoMs = 0;
let ultimaAmeaca = null;        // vai como motivo na mensagem de socorro
let dicaSocorroMs = -Infinity;

// Conversa por voz
const conversa = new Conversa();
let ouvindo = null;               // reconhecimento em curso
let modoConversa = false;         // a conversa segue sozinha, turno após turno
let silenciosSeguidos = 0;        // duas vezes sem ouvir nada encerram a conversa
let ultimaFalaImportante = null;  // para "repete"
let gpsDaCamera = false;        // o GPS foi ligado pela câmera (não pela rota)

// ---------------- Preferências ----------------
const PREFS = "iris.prefs.v3";   // v3 acrescenta navegação, vocabulário e nuvem
const prefs = Object.assign(
  // Padrão leve: três modelos de IA ao mesmo tempo estouravam a memória do
  // Safari e o app era encerrado. Piso e Lite2 ficam como opção consciente.
  // A nuvem nasce desligada por princípio, não por desempenho.
  {
    piso: false, validando: false, verbosidade: Verbosidade.NORMAL, modelo: "lite0",
    aberto: false, chaveGoogle: "", nuvemLigada: false, endpointNuvem: "/api/descrever",
    contatoSocorro: "", socorroModo: "contato",
  },
  (() => { try { return JSON.parse(localStorage.getItem(PREFS) ?? "{}"); } catch { return {}; } })()
);
const salvarPrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* modo privado */ } };

// ---------------- Guarda de queda ----------------
// Quando o navegador mata a aba por falta de memória, nenhum código nosso
// roda: não há evento, não há erro, não há log. O app simplesmente deixa de
// existir. O único rastro possível é deixar uma marca ANTES e apagá-la na
// saída limpa — se na abertura seguinte a marca ainda estiver lá, a sessão
// anterior não terminou por vontade própria.
//
// Sem isto, a pessoa reabre o app com as mesmas opções pesadas ligadas e ele
// cai de novo, e de novo, sem nunca dizer por quê. Com isto, ele volta leve e
// diz o que desligou — que é o mínimo devido a quem depende dele para andar.

const MARCA = "iris.sessao.v1";

/** Quanta memória o aparelho declara. Chrome responde; Safari não. */
const MEMORIA_GB = navigator.deviceMemory ?? null;
const MEMORIA_MIN_ABERTO = 4;   // abaixo disso o OWL-ViT derruba a aba

function marcarAtivo(etapa) {
  try {
    localStorage.setItem(MARCA, JSON.stringify({
      etapa, ts: Date.now(), versao: document.querySelector('meta[name="iris-versao"]')?.content,
      modelo: prefs.modelo, piso: prefs.piso, aberto: prefs.aberto, memoriaGB: MEMORIA_GB,
    }));
  } catch { /* modo privado: seguimos sem a guarda */ }
}

function limparMarca() {
  try { localStorage.removeItem(MARCA); } catch { /* nada a fazer */ }
}

/** Lê e consome a marca. Null quando a sessão anterior terminou limpa. */
function consumirMarca() {
  try {
    const m = JSON.parse(localStorage.getItem(MARCA) ?? "null");
    limparMarca();
    return m;
  } catch { limparMarca(); return null; }
}

/**
 * Desliga o que mais pesava e devolve a frase a dizer, ou null.
 * A escolha do que desligar segue o custo: o vocabulário aberto é de longe o
 * mais caro, o piso vem depois, e só em último caso mexemos no detector — sem
 * ele o app não serve para nada.
 */
function recuperarDeQueda(m) {
  if (!m) return null;

  // Desligamos o que estava ligado NA HORA DA QUEDA, que é o que a marca
  // guardou — e não o que está ligado agora. São a mesma coisa quase sempre,
  // mas quando não são, desligar pelo estado atual dá uma frase que mente
  // sobre o que aconteceu.
  let desligado = null;
  if (m.aberto) {
    prefs.aberto = false;
    desligado = "o reconhecimento ampliado";
  } else if (m.piso) {
    prefs.piso = false;
    desligado = "o aviso de calçada e degrau";
  } else if (m.modelo && m.modelo !== "lite0") {
    prefs.modelo = "lite0";
    desligado = "a precisão alta do reconhecimento";
  }

  if (!desligado) {
    // Já estava no mínimo e caiu assim mesmo. Não há o que desligar, e fingir
    // que resolvemos alguma coisa seria pior do que dizer a verdade.
    return "O aplicativo foi encerrado pelo celular na sessão anterior, e ele já "
      + "estava na configuração mais leve. Feche os outros aplicativos antes de usar "
      + "o Íris, e avise no diário do piloto.";
  }

  salvarPrefs();
  return "O aplicativo foi encerrado pelo celular na sessão anterior, por falta de "
    + `memória. Desliguei ${desligado} para ele voltar a funcionar. `
    + "Você pode ligar de novo nos ajustes, se quiser tentar.";
}

const marcaAnterior = consumirMarca();
// A fala precisa de um toque do usuário para sair no celular, então o aviso
// espera o primeiro toque. Na tela ele aparece de imediato.
const avisoDeQueda = recuperarDeQueda(marcaAnterior);

// ---------------- Voz ----------------
let ptVoice = null;
function pickVoice() {
  const vs = window.speechSynthesis?.getVoices() ?? [];
  ptVoice = vs.find((v) => v.lang === "pt-BR") ?? vs.find((v) => v.lang?.startsWith("pt")) ?? null;
}
window.speechSynthesis?.addEventListener?.("voiceschanged", pickVoice);
pickVoice();

// Diagnóstico da voz: sem isso, "o app não fala" é impossível de investigar
// no aparelho do testador, que não tem console.
export const vozDiag = { tentativas: 0, iniciadas: 0, erros: 0, travas: 0, ultimoErro: null, voz: null };

// O Safari do iPhone deixa `speaking` preso em true quando uma fala é cortada.
// Como a narração usa interrupt=false (para não atropelar alertas), a partir
// desse momento TUDO é descartado e o app emudece de vez. Este guarda detecta
// a fila travada e a destrava.
let falandoDesdeMs = 0;
const TRAVA_MS = 7000;

function filaTravada(s) {
  if (!s.speaking) { falandoDesdeMs = 0; return false; }
  const agora = performance.now();
  if (!falandoDesdeMs) { falandoDesdeMs = agora; return false; }
  if (agora - falandoDesdeMs < TRAVA_MS) return false;
  vozDiag.travas++;
  try { s.cancel(); } catch { /* nada a fazer */ }
  falandoDesdeMs = 0;
  return true;
}

function speak(text, interrupt) {
  const s = window.speechSynthesis;
  if (!s) { vozDiag.ultimoErro = "navegador sem síntese de voz"; return; }
  const travada = filaTravada(s);
  if (!interrupt && s.speaking && !travada) return; // não acumula fila de avisos velhos

  vozDiag.tentativas++;

  const emitir = () => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    if (ptVoice) u.voice = ptVoice;
    u.rate = 1.1;
    u.onstart = () => {
      vozDiag.iniciadas++;
      vozDiag.voz = u.voice?.name ?? "padrão do sistema";
      falandoDesdeMs = performance.now();
    };
    u.onend = () => { falandoDesdeMs = 0; };
    u.onerror = (e) => {
      // "interrupted" e "canceled" são normais quando um alerta atropela outro
      if (e.error === "interrupted" || e.error === "canceled") return;
      vozDiag.erros++;
      vozDiag.ultimoErro = e.error ?? "desconhecido";
    };
    try { s.speak(u); } catch (e) { vozDiag.erros++; vozDiag.ultimoErro = String(e?.message ?? e); }
    // o iOS às vezes deixa a fila pausada e nada sai
    if (s.paused) { try { s.resume(); } catch { /* nada a fazer */ } }
  };

  // No iOS, speak() logo depois de cancel() é engolido: o cancel ainda está
  // processando e descarta a fala nova. Um respiro curto resolve.
  if (interrupt && (s.speaking || s.pending)) {
    s.cancel();
    setTimeout(emitir, 70);
  } else {
    emitir();
  }
}

// ---------------- Arbitragem da fala ----------------
// Nada no app chama speak() direto a partir daqui. Tudo oferece à fila, e a
// fila decide. É o que impede o alerta de obstáculo de ser atropelado por uma
// narração de banco de praça, e o que impede o app de repetir a mesma frase
// seis vezes enquanto a cena não muda.

function dizer(texto, canal = Canal.NARRACAO, extra = {}) {
  if (!texto) return false;
  // Durante a conversa o app cala a narração do ambiente. Dois motivos: ela
  // atropelaria a resposta que a pessoa pediu, e entraria direto no microfone
  // aberto, virando pergunta. O alerta de obstáculo continua passando — a
  // conversa não pode custar a segurança de quem está andando.
  if (modoConversa && !extra.daConversa && canal >= Canal.DESCRICAO) return false;
  const entrou = fila.oferecer({ texto, canal, ...extra }, performance.now());
  if (entrou) bombearFala();
  return entrou;
}

const NIVEL_DO_CANAL = {
  [Canal.ALERTA]: "alta", [Canal.NAVEGACAO]: "nav", [Canal.SISTEMA]: "info",
  [Canal.DESCRICAO]: "info", [Canal.ORIENTACAO]: "nav", [Canal.NARRACAO]: "info",
};

function bombearFala() {
  const s = window.speechSynthesis;
  const ocupada = Boolean(s?.speaking || s?.pending);
  const saida = fila.proxima(performance.now(), ocupada);
  if (!saida) return;
  speak(saida.texto, saida.interromper);
  if (saida.canal !== Canal.NARRACAO) ultimaFalaImportante = saida.texto;
  mostrar(saida.texto, NIVEL_DO_CANAL[saida.canal] ?? "info");
}

// A navegação fala mesmo com a câmera desligada, então a fila não pode
// depender do laço de quadros para escoar.
setInterval(bombearFala, 350);

/** Teste de voz sob toque do usuário: a prova definitiva no aparelho. */
function testarVoz() {
  unlockAudio();
  const antes = vozDiag.iniciadas;
  speak("Teste de voz do Projeto Íris. Se você ouviu esta frase, a voz está funcionando.", true);
  signal(false);
  setTimeout(() => {
    const ok = vozDiag.iniciadas > antes;
    const vs = window.speechSynthesis?.getVoices?.() ?? [];
    $("diagVoz").textContent = ok
      ? `Voz funcionando (${vozDiag.voz}). ${vs.length} vozes no aparelho.`
      : `A voz NÃO iniciou. Vozes no aparelho: ${vs.length}. Travas: ${vozDiag.travas}. ` +
        `Erro: ${vozDiag.ultimoErro ?? "nenhum relatado"}. ` +
        `No iPhone, verifique a chave de silencioso e o volume.`;
  }, 1600);
}

/** Barra de fala: mostra na tela o que o app acabou de dizer. */
function mostrar(texto, nivel = "info", detalhe = "") {
  statusEl.textContent = texto;
  extraEl.textContent = detalhe;
  falaEl.dataset.nivel = nivel;
  liveEl.textContent = texto;
}

// ------------- Bipe / vibração -------------
let audioCtx = null;
function unlockAudio() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* sem áudio extra */ }
}

function signal(strong) {
  if (navigator.vibrate) navigator.vibrate(strong ? [120, 80, 120] : 60);
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  for (let i = 0; i < (strong ? 2 : 1); i++) {
    const t = t0 + i * 0.2;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = strong ? 880 : 660;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }
}

// ---------------- Estado ----------------
function setState(next, message, nivel = "info") {
  state = next;
  const active = next !== "parado";
  btnToggle.dataset.active = String(active);
  rotuloPrincipal.textContent = active ? "Parar" : "Iniciar";
  btnToggle.setAttribute("aria-label", active ? "Parar percepção" : "Iniciar percepção");
  btnDescrever.disabled = next !== "ativo";
  btnLerTexto.disabled = next !== "ativo";
  mostrar(message, nivel);
}

// ---------------- Modelos ----------------
async function loadDetector() {
  const { ObjectDetector, FilesetResolver } = await import(`${MP_BASE}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODELOS[prefs.modelo] ?? MODELOS.lite2, delegate },
    runningMode: "VIDEO",
    scoreThreshold: SCORE_MIN,
    maxResults: 10,
  });
  try {
    return await ObjectDetector.createFromOptions(fileset, options("GPU"));
  } catch (e) {
    console.warn("GPU indisponível; usando CPU", e);
    return await ObjectDetector.createFromOptions(fileset, options("CPU"));
  }
}

async function openCamera() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 640 }, height: { ideal: 480 } },
  });
}

async function start() {
  // Precisa acontecer dentro do toque, senão o iPhone bloqueia voz e som.
  unlockAudio();
  speak("Iniciando.", true);
  setState("carregando", "Carregando o reconhecimento…");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Este navegador não permite usar a câmera. Abra pelo Safari ou Chrome, em um endereço https.");
    }
    stream = await openCamera();
    video.srcObject = stream;
    await video.play();
    detector ??= await loadDetector();
  } catch (e) {
    console.error(e);
    diario.falha("inicio", e);
    stopCamera();
    const msg = e?.name === "NotAllowedError"
      ? "Câmera bloqueada. Libere nos ajustes do navegador e toque em Iniciar de novo."
      : `Não foi possível iniciar. ${e?.message ?? ""}`.trim();
    setState("parado", msg, "alta");
    speak(msg, true);
    return;
  }

  if (state !== "carregando") { stopCamera(); return; } // usuário parou durante o carregamento

  alerts.reset();
  motion.reset();
  ambiente.reset();
  orientacao.reset();
  orientacao.iniciar(performance.now());
  fila.reset();
  describeLeft = 0;
  describeBuffer = [];
  lastFrameAt = 0;
  fps = 0;
  pisoAtual = null;
  pisoAnterior = null;
  riscosAbertos = [];
  riscosAteMs = 0;
  ultimoAvisoPiso.clear();
  segIntervaloAtual = SEG_INTERVALO_MS;

  // Já em rota quando a câmera liga: volta a varrer o chão à frente.
  if (prefs.aberto && navegador.ativo && !varreduraTimer) {
    varreduraTimer = setInterval(() => varrerVocabularioAberto(), VARREDURA_NAV_MS);
  }

  diario.iniciar({ piso: prefs.piso, validando: prefs.validando });
  marcarAtivo("deteccao");
  barramento.publicar(Evento.SESSAO_INICIOU, { modelo: prefs.modelo, piso: prefs.piso });
  await requestWakeLock();
  setState("ativo", "Percepção ativa");
  speak("Percepção iniciada.", true);
  rafId = requestAnimationFrame(tick);
  // A velocidade de quem anda separa "alguém vindo depressa" de "duas pessoas
  // andando uma para a outra". O GPS fica no aparelho; nada sai daqui.
  if (!rastreador.ativo) gpsDaCamera = rastreador.iniciar();
  avaliador.reset();

  if (prefs.piso) iniciarPiso();
}

/** A segmentação é opcional e pesada: carrega depois, sem travar a detecção. */
async function iniciarPiso() {
  if (!segmentador.pronto) {
    pisoEl.textContent = "Preparando piso…";
    try {
      await segmentador.carregar();
    } catch (e) {
      console.warn("Modelo de piso indisponível", e);
      diario.falha("carregar_piso", e);
      pisoEl.textContent = "Piso indisponível";
      marcarAtivo("deteccao");
      return;
    }
  }
  if (state !== "ativo") return;
  pisoEl.textContent = "";
  clearInterval(segTimer);
  segTimer = setInterval(lacoPiso, segIntervaloAtual);
}

async function lacoPiso() {
  if (state !== "ativo" || !prefs.piso) return;
  const r = await segmentador.analisar(video);
  if (!r || state !== "ativo") return;

  // aparelho lento: espaça as análises em vez de engasgar
  if (r.ms > segIntervaloAtual * 0.9 && segIntervaloAtual < 3000) {
    segIntervaloAtual = Math.min(3000, Math.round(r.ms * 1.4));
    clearInterval(segTimer);
    segTimer = setInterval(lacoPiso, segIntervaloAtual);
  }

  const novo = analisarPiso(r.contagens, r.totalPixels);
  if (novo) {
    pisoAnterior = pisoAtual;
    pisoAtual = novo;
    pisoEl.textContent = novo.nome;
    pisoEl.classList.toggle("perigo", !novo.seguro);
    pisoEl.classList.toggle("calma", novo.seguro);
    diario.piso(novo);

    const aviso = avisoDePiso(pisoAtual, pisoAnterior);
    if (aviso && aviso.priority !== Priority.BAIXA && podeAvisarPiso(`piso:${novo.nome}`)) {
      const alta = aviso.priority === Priority.ALTA;
      signal(alta);
      // Pisar na via é alerta: entra pelo mesmo canal do obstáculo e cala o
      // que estivesse sendo narrado.
      if (alta) fila.calarAbaixoDe(Canal.ALERTA);
      dizer(aviso.text, Canal.ALERTA, { chave: `piso:${novo.nome}`, urgente: alta });
      diario.alerta({ text: aviso.text, priority: aviso.priority, key: `piso:${novo.nome}` });
      barramento.publicar(Evento.PISO, { nome: novo.nome, seguro: novo.seguro, texto: aviso.text });
    }
  }

  // degrau e poste: o detector de objetos não vê nenhum dos dois
  for (const obs of obstaculosDoPiso(r.contagens, r.totalPixels)) {
    if (!podeAvisarPiso(`obs:${obs.nome}`)) continue;
    const texto = `Atenção, ${obs.nome} à frente.`;
    signal(true);
    fila.calarAbaixoDe(Canal.ALERTA);
    dizer(texto, Canal.ALERTA, { chave: `obs:${obs.nome}`, urgente: true });
    diario.obstaculo(obs);
    diario.alerta({ text: texto, priority: Priority.ALTA, key: `obs:${obs.nome}` });
    break; // um aviso por ciclo: falar dois obstáculos juntos não ajuda ninguém
  }
}

function podeAvisarPiso(chave) {
  const agora = performance.now();
  const ultimo = ultimoAvisoPiso.get(chave);
  if (ultimo !== undefined && agora - ultimo < SEG_COOLDOWN_MS) return false;
  ultimoAvisoPiso.set(chave, agora);
  return true;
}

function stopCamera() {
  cancelAnimationFrame(rafId);
  clearInterval(segTimer);
  segTimer = 0;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}

function stop(announce = true) {
  const wasActive = state === "ativo";
  stopCamera();
  releaseWakeLock();
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  metricsEl.textContent = "";
  pisoEl.textContent = "";
  if (wasActive) { diario.encerrar(); atualizarResumo(); }
  // A varredura do vocabulário aberto depende da câmera; a rota, não. Quem
  // está a caminho continua sendo guiado com a câmera desligada — é assim que
  // a bateria dura a caminhada inteira.
  clearInterval(varreduraTimer);
  varreduraTimer = 0;
  riscosAbertos = [];
  fila.reset();
  if (gpsDaCamera && !navegador.ativo) rastreador.parar();
  gpsDaCamera = false;
  limparMarca();          // saída limpa: a próxima abertura não acusa queda
  setState("parado", "Parado. Toque em Iniciar para começar.");
  if (announce && wasActive) {
    speak("Percepção parada.", true);
    barramento.publicar(Evento.SESSAO_TERMINOU, {});
  }
}

// ---------------- Laço de detecção ----------------
const clamp = (v) => Math.min(1, Math.max(0, v));

function tick(now) {
  if (state !== "ativo") return;
  if (now - lastFrameAt >= 1000 / MAX_FPS && video.readyState >= 2) {
    try { processFrame(now); } catch (e) { console.error("Falha no quadro", e); diario.falha("quadro", e); }
  }
  bombearFala();
  rafId = requestAnimationFrame(tick);
}

function processFrame(now) {
  const ts = Math.max(now, lastTs + 1); // o modo VIDEO exige tempo sempre crescente
  lastTs = ts;

  const t0 = performance.now();
  const result = detector.detectForVideo(video, ts);
  const detectionMs = performance.now() - t0;

  const w = video.videoWidth;
  const h = video.videoHeight;
  const detections = result.detections.flatMap((d) => {
    const c = d.categories?.[0];
    const b = d.boundingBox;
    if (!c || !b) return [];
    return [{
      label: c.categoryName,
      score: c.score,
      box: {
        left: clamp(b.originX / w),
        top: clamp(b.originY / h),
        right: clamp((b.originX + b.width) / w),
        bottom: clamp((b.originY + b.height) / h),
      },
    }];
  });

  // O vocabulário aberto é lento demais para o laço de quadros, mas o que ele
  // achou segundos atrás continua valendo: buraco não anda. Juntamos as duas
  // fontes aqui e o resto do pipeline não precisa saber a diferença.
  const comAberto = riscosAbertos.length && ts < riscosAteMs
    ? [...detections, ...riscosAbertos]
    : detections;

  let objects = analyzeSpatial(comAberto);
  // A velocidade do GPS é o que permite ao app saber que o carro não está
  // vindo: sou eu que estou andando até ele. Sem GPS o MotionTracker se vira
  // com os objetos imóveis da cena.
  objects = motion.update(objects, ts, {
    egoMs: rastreador.ultima?.velocidadeMs ?? null,
  });
  objects = associarCortantes(objects);   // faca na mão herda a distância da pessoa

  // cor do semáforo: o COCO detecta o poste, não a luz acesa
  for (const o of objects) {
    if (o.detection.label !== "traffic light") continue;
    const r = corDoSemaforo(amostrarSemaforo(video, o.detection.box));
    if (r) o.cor = r.cor;
  }
  ultimosObjetos = objects;

  // A cena é observada em todo quadro, inclusive nos que viram alerta: é
  // assim que o app sabe quando a cena voltou a ficar parada.
  const mudanca = ambiente.observar(objects, ts);

  // Ameaças antes do alerta comum: elas olham trajetória e tempo até o
  // impacto, e quando falam o alerta comum cala sobre o mesmo objeto.
  const falouAmeaca = tratarAmeacas(objects, ts);

  const alert = falouAmeaca ? null : alerts.process(objects, ts);
  if (falouAmeaca) {
    // nada: a ameaça já ocupou a voz neste quadro
  } else if (alert) {
    const high = alert.priority === Priority.ALTA;
    // O bipe só acompanha uma fala que vai mesmo sair. Bipar sem falar deixa a
    // pessoa parada procurando um aviso que nunca veio.
    if (dizer(alert.text, Canal.ALERTA, { chave: alert.key, urgente: high })) {
      signal(high);
      fila.calarAbaixoDe(Canal.ALERTA);   // o que ia ser dito agora virou ruído
      diario.alerta(alert);
      barramento.publicar(Evento.ALERTA, { texto: alert.text, prioridade: alert.priority });
    }
  } else if (describeLeft === 0 && !lendoTexto) {
    narrarAmbiente(objects, ts, mudanca);
  }

  if (describeLeft > 0) {
    describeBuffer.push(objects);
    describeLeft--;
    if (describeLeft === 0) {
      const quadros = describeBuffer;
      describeBuffer = [];
      concluirDescricao(quadros).catch((e) => {
        diario.falha("descricao", e);
        dizer(e?.message ?? "Não consegui descrever.", Canal.SISTEMA, { interrompe: true });
        btnDescrever.querySelector(".rotulo").textContent = "O que tem aqui?";
      });
    }
  }

  if (lastFrameAt) {
    const inst = 1000 / Math.max(1, now - lastFrameAt);
    fps = fps ? fps * 0.9 + inst * 0.1 : inst;
  }
  lastFrameAt = now;
  // a contagem mostra que o app está vendo, mesmo quando decide não falar
  metricsEl.textContent =
    `${fps.toFixed(1)} qps · ${Math.round(detectionMs)} ms · ${objects.length} obj`;

  diario.metrica({ fps, detectionMs, segMs: segmentador.ultimoMs || null, objetos: objects.length });
  draw(objects, w, h);
}

// ---------------- Narração do ambiente ----------------
// O que mudou entre a versão anterior e esta: antes, cada objeto novo virava
// uma frase, uma por vez, a cada 1,1 s. Com quatro coisas na calçada o app
// gastava cinco segundos recitando lista e, no fim, repetia a primeira. Agora
// a cena parada é silêncio e as novidades saem juntas, numa frase só.

function narrarAmbiente(objects, ts, mudanca) {
  const fala = ambiente.proxima(objects, ts, prefs.verbosidade, mudanca);
  if (!fala) return;
  // Confirmamos só depois de a fila aceitar: uma frase recusada tem de poder
  // voltar a ser novidade, senão o objeto nasce calado para sempre.
  if (dizer(fala.texto, Canal.NARRACAO, { chave: fala.eventos.map((e) => e.chave).join("+") })) {
    ambiente.confirmar(fala.eventos, ts);
    diario.alerta({ text: fala.texto, tipo: "ambiente", priority: Priority.BAIXA });
  }
}

// ---------------- Orientação ----------------
// A camada que faltava. Até a 0.13 o app só dizia onde a pessoa estava quando
// ela apertava "Onde estou?"; andando, ela ouvia inventário de objetos e mais
// nada. Um minuto de calçada rendia trinta frases e nenhuma dizia a rua.
//
// Esta é a fala mais barata do app em atenção e a mais cara em confiança: é
// ela que diz "você está na Rua X, caminho livre, faltam 80 metros". Por isso
// mora no canal mais baixo, espera a voz vagar e prefere calar a repetir.
//
// Roda em temporizador próprio, e não no laço de quadros, porque continua
// fazendo sentido com a câmera desligada: rua e distância vêm do GPS.

const ORIENTA_TICK_MS = 3000;
/** Só reconsulta o nome da rua depois de andar isto: Nominatim não é de graça. */
const RECONSULTA_VIA_M = 40;
/** Acima disto a pessoa está andando, e a orientação se espaça menos. */
const ANDANDO_MS = 0.4;

let viaAtual = null;      // "Rua Barão de Melgaço"
let viaPos = null;        // onde ela foi consultada
let viaBuscando = false;

async function atualizarVia(pos) {
  if (viaBuscando || !pos) return;
  if (viaPos && distanciaM(pos, viaPos) < RECONSULTA_VIA_M) return;
  viaBuscando = true;
  try {
    const via = soAVia(enderecoFalado((await reverso(pos)) ?? {}));
    // Só aceita a troca se veio nome: uma falha do Nominatim não pode apagar
    // a rua que a pessoa já ouviu e está usando para se situar.
    if (via) { viaAtual = via; viaPos = pos; }
  } catch { /* sem rede, sem rua: a orientação segue com o que tem */ }
  finally { viaBuscando = false; }
}

function tickOrientacao() {
  if (state !== "ativo" && !navegador.ativo) return;
  if (modoConversa) return;          // a pessoa está falando com o app

  const pos = rastreador.ultima;
  if (pos) atualizarVia(pos);

  const rumo = bussola.disponivel && bussola.graus != null ? bussola.graus : (pos?.rumoGraus ?? null);
  const faltamM = navegador.ativo ? navegador.restanteM(pos) : null;

  const f = orientacao.proxima(performance.now(), {
    via: viaAtual,
    cardeal: rumo != null && Number.isFinite(rumo) ? cardeal(rumo) : null,
    destino: navegador.ativo ? rotaAtual?.destino?.nome ?? null : null,
    faltamM,
    andando: (pos?.velocidadeMs ?? 0) >= ANDANDO_MS,
    // Com a câmera parada o app não afirma que o caminho está livre: dizer
    // isso sem estar vendo é o tipo de frase que derruba quem confia nela.
    caminho: caminhoAFrente(ultimosObjetos, { vendo: state === "ativo" }),
  });
  if (!f) return;
  if (dizer(f.texto, Canal.ORIENTACAO, { chave: f.chave })) {
    diario.alerta({ text: f.texto, tipo: "orientacao", priority: Priority.BAIXA });
  }
}

setInterval(tickOrientacao, ORIENTA_TICK_MS);

function describe() {
  if (state !== "ativo") { unlockAudio(); speak("Inicie a percepção primeiro.", true); return; }
  signal(false); // confirma o toque
  describeBuffer = [];
  describeLeft = DESCRIBE_FRAMES;
  btnDescrever.querySelector(".rotulo").textContent = "Olhando…";
}

/**
 * A descrição tem três camadas, da mais barata para a mais cara, e cada uma
 * só entra se a anterior não bastar e se o usuário tiver escolhido pagá-la:
 *
 *   1. Local, instantânea — o que o detector já viu nos últimos quadros.
 *   2. Vocabulário aberto, uns segundos — buraco, degrau, tapume, piso tátil,
 *      porta, escada: o que o COCO não conhece. Continua no aparelho.
 *   3. Nuvem, se ligada — a leitura da cena como um todo, com o arranjo das
 *      coisas e o texto das placas. Única que manda imagem para fora.
 */
async function concluirDescricao(quadros) {
  const rotulo = btnDescrever.querySelector(".rotulo");
  const contexto = contextoLocal({
    objetos: ultimosObjetos,
    piso: pisoAtual?.nome ?? null,
    navegando: navegador.ativo ? rotaAtual?.destino?.nome ?? null : null,
    local: prefixoDescricao,
  });
  const prefixo = prefixoDescricao ? `${prefixoDescricao} ` : "";
  prefixoDescricao = null;

  // Camada 3 primeiro, quando ligada: ela substitui as outras, não soma.
  // Duas descrições da mesma cena, uma atrás da outra, é o oposto do que se
  // quer de um app que já fala demais.
  if (prefs.nuvemLigada && nuvem.configurado) {
    rotulo.textContent = "Enviando…";
    mostrar("Enviando uma foto para a descrição detalhada…", "info");
    try {
      const { texto, ms } = await nuvem.descrever(video, contexto);
      rotulo.textContent = "O que tem aqui?";
      dizer(`${prefixo}${texto}`, Canal.DESCRICAO, { interrompe: true, validadeMs: 30000 });
      mostrar("Descrição detalhada", "info", texto);
      diario.descricao(texto);
      barramento.publicar(Evento.DESCRICAO, { texto, origem: "nuvem", ms });
      return;
    } catch (e) {
      // Falhou a nuvem? Não deixamos quem perguntou sem resposta: cai para o
      // que o aparelho sabe, e diz por quê em uma frase.
      mostrar(e.message, "info");
      diario.falha("nuvem", e);
    }
  }

  let texto = describeScene(quadros);
  if (pisoAtual) texto = `Você está em ${pisoAtual.nome}. ${texto}`;

  if (prefs.aberto) {
    rotulo.textContent = "Olhando melhor…";
    const extra = await varrerVocabularioAberto({ descricao: true });
    if (extra) texto = `${texto} ${extra}`;
  }

  rotulo.textContent = "O que tem aqui?";
  texto = `${prefixo}${prefixo ? "Pela câmera: " : ""}${texto}`;
  dizer(texto, Canal.DESCRICAO, { interrompe: true, validadeMs: prefixo ? 30000 : 15000 });
  mostrar("Descrição do ambiente", "info", texto);
  diario.descricao(texto);
  barramento.publicar(Evento.DESCRICAO, { texto, origem: "local" });
}

// ---------------- Vocabulário aberto ----------------
// Caro demais para o laço de quadros (1 a 4 s por passada), então roda sob
// demanda e, durante a navegação, em varreduras espaçadas do chão à frente.

const VALIDADE_RISCO_MS = 6000;   // buraco não anda, mas a câmera vira

/** O aparelho aguenta carregar o modelo de vocabulário aberto? */
function memoriaBastaParaAberto() {
  if (MEMORIA_GB === null) return true;      // navegador não conta: deixamos tentar
  return MEMORIA_GB >= MEMORIA_MIN_ABERTO;
}

async function varrerVocabularioAberto({ descricao = false } = {}) {
  if (!prefs.aberto || state !== "ativo") return null;
  if (!memoriaBastaParaAberto()) {
    prefs.aberto = false;
    salvarPrefs();
    if (chkAberto) chkAberto.checked = false;
    dizer(`Este aparelho tem ${MEMORIA_GB} gigabytes de memória, e o reconhecimento `
      + "ampliado precisa de pelo menos quatro. Desliguei para o aplicativo não cair.",
      Canal.SISTEMA, { interrompe: true });
    return null;
  }

  // A marca diz ao próximo início o que estava acontecendo, caso o navegador
  // mate a aba durante a carga — que é o momento de maior consumo.
  marcarAtivo("vocabulario");
  // Enquanto a varredura roda, o laço de quadros para. São dois modelos na
  // memória ao mesmo tempo; manter o detector rápido girando a 12 qps em cima
  // disso é o que estoura o aparelho.
  const estavaRodando = rafId !== 0;
  if (estavaRodando) { cancelAnimationFrame(rafId); rafId = 0; }

  try {
    if (!detectorAberto.pronto) {
      mostrar("Preparando o reconhecimento ampliado (uma vez só).", "info");
      await detectorAberto.carregar();
    }
    const r = await detectorAberto.varrer(video);
    if (!r) return null;

    const id = ++idVarredura;
    riscosAbertos = r.deteccoes.map((d) => ({ ...d, varredura: id }));
    riscosAteMs = performance.now() + VALIDADE_RISCO_MS;
    diario.alerta({ text: `[varredura ${r.ms} ms, ${r.deteccoes.length} riscos]`,
      tipo: "varredura", priority: Priority.BAIXA });

    // Risco de via vira dado georreferenciado para quem quiser integrar —
    // sem imagem nenhuma junto, por princípio.
    const pos = rastreador.ultima;
    for (const d of r.deteccoes) {
      if (d.risco !== "alto") continue;
      barramento.publicar(Evento.RISCO_ABERTO, registroDeRisco({
        classe: d.pt, confianca: d.score, posicao: pos, metros: null,
      }));
    }

    if (!descricao || r.deteccoes.length === 0) return null;
    const porNome = new Map();
    // Ameaça não entra na descrição: quem fala dela é o avaliador, com cautela.
    for (const d of r.deteccoes) if (d.pt) porNome.set(d.pt, (porNome.get(d.pt) ?? 0) + 1);
    const itens = [...porNome.entries()].slice(0, 4)
      .map(([nome, n]) => (n === 1 ? nome : `${numero(n, false)} ${nome}`));
    return `No chão e em volta: ${itens.join(", ")}.`;
  } catch (e) {
    diario.falha("vocabulario-aberto", e);
    return null;
  } finally {
    marcarAtivo("deteccao");
    if (estavaRodando && state === "ativo" && rafId === 0) rafId = requestAnimationFrame(tick);
  }
}

// ---------------- Leitura de texto ----------------
async function lerTexto() {
  if (state !== "ativo") { unlockAudio(); speak("Inicie a percepção primeiro.", true); return; }
  if (lendoTexto) return;
  lendoTexto = true;
  const rot = btnLerTexto.querySelector(".rotulo");
  const original = "Ler texto";
  signal(false);

  try {
    if (!leitor.pronto) {
      rot.textContent = "Baixando…";
      mostrar("Preparando a leitura de texto (uma vez só).", "texto");
      speak("Preparando a leitura de texto.", true);
      await leitor.carregar();
    }
    rot.textContent = "Lendo…";
    mostrar("Lendo o texto…", "texto");
    speak("Lendo.", true);

    const r = await leitor.ler(video);
    if (!r) { mostrar("Não foi possível ler agora.", "texto"); speak("Não foi possível ler agora.", true); return; }

    if (!r.texto) {
      const msg = "Não consegui ler nenhum texto. Aproxime a câmera e mantenha firme.";
      mostrar("Nenhum texto reconhecido.", "texto", `Confiança baixa (${r.confianca}%).`);
      speak(msg, true);
      diario.descricao("[ocr vazio]");
      return;
    }

    mostrar("Texto lido", "texto", r.texto);
    speak(r.texto, true);
    diario.descricao(`[ocr ${r.confianca}%] ${r.texto}`);
  } catch (e) {
    console.error(e);
    diario.falha("ocr", e);
    mostrar("A leitura de texto falhou.", "texto", String(e?.message ?? e));
    speak("A leitura de texto falhou.", true);
  } finally {
    rot.textContent = original;
    lendoTexto = false;
  }
}

// ---------------- Desenho ----------------
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COLORS = {
  [Proximity.PERTO]: css("--perto"),
  [Proximity.MEDIO]: css("--medio"),
  [Proximity.LONGE]: css("--longe"),
};

function draw(objects, vw, vh) {
  const dpr = window.devicePixelRatio || 1;
  const cw = overlay.clientWidth;
  const ch = overlay.clientHeight;
  if (overlay.width !== Math.round(cw * dpr) || overlay.height !== Math.round(ch * dpr)) {
    overlay.width = Math.round(cw * dpr);
    overlay.height = Math.round(ch * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  // O vídeo usa object-fit: cover — preenche a moldura e corta o excedente.
  // A imagem visível é maior que o quadro: escala pelo MAIOR fator, e o
  // deslocamento é negativo (parte do quadro fica fora da tela).
  const escala = Math.max(cw / vw, ch / vh);
  const dw = vw * escala;
  const dh = vh * escala;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;

  // faixa do piso analisada, discreta
  if (prefs.piso && segmentador.pronto) {
    ctx.strokeStyle = "rgba(127, 233, 255, .30)";
    ctx.setLineDash([8, 7]);
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 0.25 * dw, oy + 0.60 * dh, 0.50 * dw, 0.40 * dh);
    ctx.setLineDash([]);
  }

  ctx.font = '700 14px "Atkinson Hyperlegible", system-ui, sans-serif';
  ctx.textBaseline = "middle";

  for (const o of objects) {
    const b = o.detection.box;
    const x = ox + b.left * dw;
    const y = oy + b.top * dh;
    const bw = (b.right - b.left) * dw;
    const bh = (b.bottom - b.top) * dh;
    const cor = COLORS[o.proximity];

    // caixa com cantos, no estilo do conceito
    ctx.strokeStyle = cor;
    ctx.lineWidth = o.inPath ? 4 : 2.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, bh, 8); else ctx.rect(x, y, bw, bh);
    ctx.stroke();

    // etiqueta: nome e distância, como "Pessoa (2,5 m)"
    const nome = NOMES[o.detection.label]?.singular ?? o.detection.label;
    const metros = o.distanceM != null ? ` (${o.distanceM.toFixed(1).replace(".", ",")} m)` : "";
    const texto = (o.cor ? `semáforo ${o.cor}` : nome) + metros + (o.approaching ? " ↓" : "");
    const tw = ctx.measureText(texto).width;
    const th = 22;
    const ex = Math.max(2, Math.min(cw - tw - 14, x));
    const ey = y - th - 4 < 2 ? y + 4 : y - th - 4;

    ctx.fillStyle = cor;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ex, ey, tw + 12, th, 7); else ctx.rect(ex, ey, tw + 12, th);
    ctx.fill();
    ctx.fillStyle = o.proximity === Proximity.MEDIO ? "#06101C" : "#FFFFFF";
    ctx.fillText(texto, ex + 6, ey + th / 2 + 1);
  }
}

// ---------------- Navegação a pé ----------------
// Funciona com a câmera ligada ou desligada. Com a câmera ligada, as duas se
// somam: a rota diz para onde ir, a câmera diz o que há no caminho — e quando
// a câmera reconhece um semáforo ou um poste do lado da manobra, a instrução
// ganha uma referência que a pessoa consegue confirmar com a bengala.

const navBarra = $("navBarra");
const navDestinoEl = $("navDestino");
const navRestanteEl = $("navRestante");
const btnIr = $("ir");
const btnPararRota = $("pararRota");
const dlgDestino = $("destino");
const campoDestino = $("campoDestino");
const VARREDURA_NAV_MS = 9000;

function atualizarPainelNav() {
  const ativo = navegador.ativo;
  document.body.dataset.navegando = String(ativo);
  if (!ativo) { navDestinoEl.textContent = ""; navRestanteEl.textContent = ""; return; }
  navDestinoEl.textContent = rotaAtual?.destino?.nome ?? destinoAtual;
  const falta = navegador.restanteM(rastreador.ultima);
  navRestanteEl.textContent = falta != null ? distanciaFalada(falta) : "";
}

async function iniciarNavegacao(texto) {
  const destino = String(texto ?? "").trim();
  if (!destino) return;
  destinoAtual = destino;

  unlockAudio();
  dizer(`Procurando o caminho até ${destino}.`, Canal.SISTEMA, { interrompe: true });

  // A bússola só pode ser pedida dentro de um gesto do usuário no iPhone.
  // Este caminho começa no toque do botão, então é aqui que se pede.
  bussola.iniciar().then((ok) => {
    if (!ok) dizer(
      "Sem bússola neste aparelho. Vou indicar os rumos pelo norte, e os lados só quando você estiver andando.",
      Canal.SISTEMA, { chave: "nav:sem-bussola" });
  });

  try {
    const origem = await rastreador.umaVez();
    rastreador.iniciar();

    // Um provedor registrado (Lumiar, por exemplo) responde antes do
    // buscador genérico: ele sabe coisas que o mapa não sabe.
    const doProvedor = (await buscarEmProvedores(destino, origem))[0];
    const alvo = doProvedor
      ? { nome: doProvedor.nome, lat: doProvedor.lat, lng: doProvedor.lng }
      : destino;

    rotaAtual = await tracarRota({
      chaveGoogle: prefs.chaveGoogle, origem, destino: alvo, posicaoAtual: origem,
    });

    // Uma frase só. A fila guarda uma fala pendente por canal, então oferecer
    // duas seguidas no canal do sistema faria a segunda apagar a primeira —
    // e o aviso de qualidade da rota é informação que não pode sumir.
    const recados = [rotaAtual.avisoDeQualidade, doProvedor?.acessibilidade].filter(Boolean);
    if (recados.length) dizer(recados.join(" "), Canal.SISTEMA, { chave: "nav:recados" });

    const inicio = navegador.iniciar(rotaAtual);
    dizer(inicio.texto, Canal.NAVEGACAO, { chave: inicio.chave, validadeMs: 20000 });
    atualizarPainelNav();
    signal(false);

    diario.alerta({ text: inicio.texto, tipo: "nav-inicio", priority: Priority.MEDIA });
    barramento.publicar(Evento.NAV_INICIOU, {
      destino: rotaAtual.destino.nome, metros: rotaAtual.distanciaM, provedor: rotaAtual.provedor,
    });

    // Durante o deslocamento, o chão à frente passa a ser varrido de tempos em
    // tempos: é andando que se cai num buraco, não parado olhando a cena.
    if (prefs.aberto && state === "ativo") {
      clearInterval(varreduraTimer);
      varreduraTimer = setInterval(() => varrerVocabularioAberto(), VARREDURA_NAV_MS);
    }
  } catch (e) {
    rotaAtual = null;
    rastreador.parar();
    const msg = e?.message ?? "Não consegui traçar a rota.";
    dizer(msg, Canal.SISTEMA, { interrompe: true });
    diario.falha("rota", e);
    atualizarPainelNav();
  }
}

function pararNavegacao(anunciar = true) {
  const estava = navegador.ativo;
  navegador.parar();
  rastreador.parar();
  bussola.parar();
  clearInterval(varreduraTimer);
  varreduraTimer = 0;
  rotaAtual = null;
  recalculando = false;
  atualizarPainelNav();
  if (estava && anunciar) dizer("Rota encerrada.", Canal.SISTEMA, { interrompe: true });
}

function aoMoverPosicao(p) {
  if (!navegador.ativo) return;
  const eventos = navegador.atualizar(p, bussola.disponivel ? bussola.graus : null, performance.now());

  for (const ev of eventos) {
    if (ev.recalcular) {
      // A frase de "saiu do caminho" diz para que lado a rota fica: ela
      // precisa sair antes do recálculo, senão a pessoa fica sem orientação.
      if (ev.texto) {
        dizer(ev.texto, Canal.NAVEGACAO, { chave: ev.chave, urgente: ev.urgente, validadeMs: 6000 });
        diario.alerta({ text: ev.texto, tipo: "nav-fora", priority: Priority.MEDIA });
      }
      recalcularRota();
      continue;
    }

    let texto = ev.texto;
    // A câmera dá o que o mapa não tem: um ponto que se confirma com a bengala.
    if (ev.tipo === "manobra" && state === "ativo") {
      const lado = /esquerda/.test(texto) ? "à esquerda" : /direita/.test(texto) ? "à direita" : null;
      const ref = lado && referenciaNoLado(ultimosObjetos, lado, NOMES);
      if (ref) texto = texto.replace(/\.$/, `, logo depois do ${ref}.`);
    }

    if (ev.urgente) signal(ev.tipo === "travessia");
    dizer(texto, Canal.NAVEGACAO, { chave: ev.chave, urgente: ev.urgente });
    diario.alerta({ text: texto, tipo: `nav-${ev.tipo}`, priority: Priority.MEDIA });

    if (ev.tipo === "chegada") {
      barramento.publicar(Evento.NAV_CHEGOU, { destino: rotaAtual?.destino?.nome });
      setTimeout(() => pararNavegacao(false), 1200);
    } else if (ev.tipo === "manobra" || ev.tipo === "travessia") {
      barramento.publicar(Evento.NAV_MANOBRA, { texto, tipo: ev.tipo });
    }
  }
  atualizarPainelNav();
}

async function recalcularRota() {
  if (recalculando || !destinoAtual) return;
  recalculando = true;
  barramento.publicar(Evento.NAV_FORA_DE_ROTA, { destino: destinoAtual });
  try {
    const origem = rastreador.ultima ?? await rastreador.umaVez();
    rotaAtual = await tracarRota({
      chaveGoogle: prefs.chaveGoogle, origem,
      destino: rotaAtual.destino, posicaoAtual: origem,   // já é ponto: não busca de novo
    });
    const inicio = navegador.iniciar(rotaAtual, { recalculo: true });
    dizer(inicio.texto, Canal.NAVEGACAO, { chave: `recalc:${Date.now()}`, validadeMs: 20000 });
  } catch (e) {
    diario.falha("recalculo", e);
    dizer("Não consegui recalcular agora. Siga com cuidado e eu tento de novo.",
      Canal.SISTEMA, { chave: "nav:recalc-falhou" });
  } finally {
    recalculando = false;
  }
}

// ---------------- Tela sempre ligada ----------------
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch { wakeLock = null; }
}
function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// O iPhone corta a câmera quando o app sai da tela — e isso acontece a toda
// notificação ou toque na Central de Controle. Antes nós parávamos de vez e o
// usuário tinha de apertar Iniciar de novo; parecia que o app "caía" sozinho.
// Agora guardamos que estávamos ativos e retomamos ao voltar.
let retomarAoVoltar = false;

document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    if (state === "ativo" || state === "carregando") {
      retomarAoVoltar = true;
      stop(false);
    }
    return;
  }
  if (!retomarAoVoltar) return;
  retomarAoVoltar = false;
  mostrar("Retomando a percepção…");
  try {
    await start();
  } catch (e) {
    diario.falha("retomada", e);
    setState("parado", "A percepção parou. Toque em Iniciar.", "alta");
  }
});

// A tela sempre ligada é perdida quando a página sai de vista; readquire.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state === "ativo" && !wakeLock) requestWakeLock();
});

// ---------------- Validação do piloto ----------------
function contexto() {
  return {
    objetos: ultimosObjetos.slice(0, 6).map((o) => ({
      classe: o.detection.label, direcao: o.direction,
      metros: o.distanceM ?? null, noCaminho: o.inPath, vindo: o.approaching ?? false,
    })),
    piso: pisoAtual?.nome ?? null,
    ultimoAviso: statusEl.textContent || null,
  };
}

function relatar(tipo, confirmacao) {
  if (state !== "ativo") { speak("Inicie a percepção antes de marcar.", true); return; }
  diario.erro(tipo, contexto());
  signal(false);
  speak(confirmacao, true);
  atualizarResumo();
  barramento.publicar(Evento.ERRO_MARCADO, { tipo, contexto: contexto() });
}

function atualizarResumo() {
  const r = diario.resumo();
  $("resumoDiario").textContent =
    `Sessão: ${r.duracaoMin} min, ${r.alertas} avisos, ${r.fpsMedio} qps em média. ` +
    `Marcados: ${r.avisosErrados} errados, ${r.obstaculosPerdidos} não avisados.`;
}

// ---------------- Eventos ----------------
// O aviso de queda espera o primeiro toque, porque voz sem gesto do usuário
// não sai no celular. Na tela ele já apareceu assim que o app abriu.
let quedaPorDizer = avisoDeQueda;
btnToggle.addEventListener("click", () => {
  if (quedaPorDizer) {
    unlockAudio();
    speak(quedaPorDizer, true);
    quedaPorDizer = null;
    return;                      // este toque é só para ouvir o aviso
  }
  return state === "parado" ? start() : stop();
});
btnDescrever.addEventListener("click", describe);
btnLerTexto.addEventListener("click", lerTexto);
$("errou").addEventListener("click", () => relatar(TipoErro.FALSO_POSITIVO, "Aviso errado marcado."));
$("perdeu").addEventListener("click", () => relatar(TipoErro.NAO_AVISOU, "Obstáculo não avisado, marcado."));

$("abrirAjustes").addEventListener("click", () => {
  atualizarResumo();
  atualizarDiagMemoria();
  dlgAjustes.showModal();
});

// ---------------- Ameaças ----------------

function velocidadeAtual() {
  const u = rastreador.ultima;
  // Leitura velha não diz nada sobre agora: melhor "não sei" (o avaliador
  // então é conservador) do que uma velocidade de dez segundos atrás.
  return u && Date.now() - u.ts < 5000 ? u.velocidadeMs : undefined;
}

function tratarAmeacas(objects, ts) {
  const lista = avaliador.avaliar(objects, { velocidadeMs: velocidadeAtual() }, ts);
  for (const c of avaliador.classesAtivas) alerts.silenciar(c, ts + 1500);
  let falou = false;
  for (const a of lista) {
    if (a.pedirConfirmacao) { confirmarAmeaca(); continue; }
    const critica = a.nivel === Nivel.CRITICA;
    if (!dizer(a.texto, Canal.ALERTA, { chave: a.chave, urgente: a.nivel <= Nivel.ALTA, interrompe: critica })) continue;
    falou = true;
    signal(true);
    fila.calarAbaixoDe(Canal.ALERTA);
    if (a.classe) alerts.silenciar(a.classe, ts + 5000);
    ultimaAmeaca = { ...a, ts: performance.now() };
    diario.alerta({ text: a.texto, tipo: `ameaca-${a.tipo}`, priority: Priority.ALTA });
    barramento.publicar(Evento.ALERTA, { texto: a.texto, prioridade: Priority.ALTA, ameaca: a.tipo });
    // A dica do socorro vem depois, no canal do sistema, e no máximo a cada
    // cinco minutos: lembrar sempre seria só mais barulho no pior momento.
    if (a.oferecerSocorro && ts - dicaSocorroMs > 300000) {
      dicaSocorroMs = ts;
      dizer("Se precisar de ajuda, segure o botão de socorro.", Canal.SISTEMA, { chave: "sos:dica" });
    }
  }
  return falou;
}

/**
 * Uma possível arma vista numa varredura só não é dita. Pedimos uma segunda
 * olhada imediata, só com as frases de ameaça (rápida), para confirmar ou
 * descartar. Duas observações independentes é o mínimo para falar.
 */
async function confirmarAmeaca() {
  const agora = performance.now();
  if (confirmandoAmeaca || agora - ultimaConfirmacaoMs < 4000) return;
  if (!detectorAberto.pronto || state !== "ativo") return;
  confirmandoAmeaca = true;
  ultimaConfirmacaoMs = agora;
  const estavaRodando = rafId !== 0;
  if (estavaRodando) { cancelAnimationFrame(rafId); rafId = 0; }
  try {
    const r = await detectorAberto.varrer(video, { consultas: consultasDeAmeaca() });
    if (r?.deteccoes?.length) {
      const id = ++idVarredura;
      const novas = r.deteccoes.map((d) => ({ ...d, varredura: id }));
      riscosAbertos = [...riscosAbertos.filter((d) => d.grupo !== "ameaca"), ...novas,
        ...riscosAbertos.filter((d) => d.grupo === "ameaca")];
      riscosAteMs = performance.now() + VALIDADE_RISCO_MS;
    }
  } catch (e) {
    diario.falha("confirmar-ameaca", e);
  } finally {
    confirmandoAmeaca = false;
    if (estavaRodando && state === "ativo" && rafId === 0) rafId = requestAnimationFrame(tick);
  }
}

// ---------------- Socorro ----------------
// Segurar o botão por 1,2 s, para um toque sem querer não disparar. O app
// abre a mensagem pronta (com o mapa) para o contato de confiança — o envio
// final é da pessoa, porque um navegador não manda SMS sozinho, e isso é bom:
// ninguém recebe um alarme falso por um toque no bolso.

const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent ?? "");

async function pedirSocorro() {
  unlockAudio();
  signal(true);
  if (prefs.socorroModo === "190") {
    speak("Ligando para a Polícia Militar, 190.", true);
    setTimeout(() => { location.href = "tel:190"; }, 1500);
    return;
  }
  speak("Pedindo socorro. Pegando a sua localização.", true);
  const pos = await rastreador.umaVez(8000).catch(() => null);
  const motivo = ultimaAmeaca && performance.now() - (ultimaAmeaca.ts ?? 0) < 600000
    ? { colisao: "veículo", queda: "risco de queda", pessoa: "pessoa por perto", arma: "possível arma de fogo", cabeca: "obstáculo" }[ultimaAmeaca.tipo]
    : null;
  const texto = mensagemDeSocorro({
    lat: pos?.lat, lng: pos?.lng, precisaoM: pos?.precisaoM,
    endereco: ultimoOndeEstou?.endereco ?? null, motivo,
  });
  diario.alerta({ text: "[socorro]", tipo: "socorro", priority: Priority.ALTA });

  if (prefs.contatoSocorro) {
    speak("Abri a mensagem de socorro para o seu contato, com a sua localização. Toque em enviar para mandar.", true);
    setTimeout(() => { location.href = linkSms(prefs.contatoSocorro, texto, { ios: IOS }); }, 2500);
  } else if (navigator.share) {
    speak("Você ainda não tem contato de socorro. Escolha para quem mandar a sua localização.", true);
    try { await navigator.share({ title: "Socorro", text: texto }); } catch { /* cancelou */ }
  } else {
    speak("Cadastre um contato de socorro nos ajustes. Se for urgente, ligue 190.", true);
  }
}

(() => {
  const btn = $("socorro");
  if (!btn) return;
  let timer = 0;
  const soltar = () => { clearTimeout(timer); timer = 0; };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    unlockAudio();
    speak("Segure para pedir socorro.", true);
    timer = setTimeout(() => { timer = 0; pedirSocorro(); }, 1200);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, soltar);
  // Leitor de tela: o duplo toque do TalkBack/VoiceOver vira "click", sem
  // pointerdown longo. Ali o próprio gesto já é deliberado, então vale.
  btn.addEventListener("click", (e) => { if (e.detail === 0) pedirSocorro(); });
})();

// ---------------- Conversa por voz ----------------
// Um botão largo, "Conversar". Toque uma vez e a conversa começa: o app
// escuta, responde e volta a escutar sozinho, turno após turno, até a pessoa
// encerrar — pelo botão ou falando ("pode parar", "obrigado", "tchau").
// Comando conhecido resolve aqui mesmo, sem internet; pergunta livre vai à IA
// de visão, se a pessoa ligou a descrição detalhada.
//
// O estado de "ouvindo" mora em DOIS lugares de propósito: `modoConversa`
// (a conversa está aberta) e `ouvindo` (há um microfone aberto agora). Eles
// não são a mesma coisa — entre a resposta e o turno seguinte a conversa está
// aberta e o microfone está fechado — e foi confundir os dois que travou o
// botão na versão anterior.

// Três estados, e o rótulo diz qual é. Quem não enxerga não vê o botão mudar
// de cor, então cada transição também é falada ou vibrada.
const ESTADO_CONVERSA = { PARADA: "parada", OUVINDO: "ouvindo", PENSANDO: "pensando" };

function marcarConversa(estado) {
  const b = $("perguntar");
  if (!b) return;
  b.dataset.estado = estado;
  b.dataset.ouvindo = String(estado === ESTADO_CONVERSA.OUVINDO);
  $("rotuloPerguntar").textContent =
    estado === ESTADO_CONVERSA.OUVINDO ? "Ouvindo… fale agora"
      : estado === ESTADO_CONVERSA.PENSANDO ? "Um instante…"
        : "Conversar";
  b.setAttribute("aria-label", estado === ESTADO_CONVERSA.PARADA
    ? "Conversar com o Íris. Toque e fale."
    : "Conversando. Toque para encerrar a conversa.");
}

/**
 * Espera a voz do app terminar antes de reabrir o microfone.
 *
 * Sem isto o Íris ouve a si mesmo: o reconhecimento pega a própria resposta e
 * a devolve como pergunta. O teto existe porque no iPhone `speaking` às vezes
 * fica presa em true e esperar para sempre mataria a conversa.
 */
function quandoCalar(callback, tetoMs = 12000) {
  const limite = performance.now() + tetoMs;
  const olhar = () => {
    const s = window.speechSynthesis;
    const falando = Boolean(s?.speaking || s?.pending);
    if (!falando || performance.now() > limite) { setTimeout(callback, 180); return; }
    setTimeout(olhar, 150);
  };
  olhar();
}

/**
 * Um turno de escuta. A conversa inteira é feita de turnos destes:
 * escuta -> responde -> escuta de novo, até a pessoa encerrar.
 */
function escutarTurno() {
  if (!modoConversa) return;
  try { window.speechSynthesis?.cancel(); } catch { /* sem voz */ }
  marcarConversa(ESTADO_CONVERSA.OUVINDO);
  signal(false);

  ouvindo = ouvirFala({
    aoOuvir: (texto) => {
      silenciosSeguidos = 0;
      mostrar(`Você: ${texto}`, "info");
      marcarConversa(ESTADO_CONVERSA.PENSANDO);
      responderFala(texto);
    },
    aoFalhar: (e) => {
      // Silêncio não é erro de verdade: é a pessoa pensando, ou barulho de
      // rua. Avisa na primeira vez, encerra na segunda — microfone aberto
      // sem ninguém falando gasta bateria e dá a impressão de que o app
      // travou, que foi exatamente o que aconteceu no teste.
      if (/Não ouvi nada/i.test(e.message)) {
        silenciosSeguidos += 1;
        if (silenciosSeguidos >= 2) { encerrarConversa("Conversa encerrada."); return; }
        dizer("Não ouvi. Pode falar.", Canal.SISTEMA, { interrompe: true, daConversa: true, chave: "voz:silencio" });
        return;
      }
      dizer(e.message, Canal.SISTEMA, { interrompe: true, daConversa: true, chave: `voz:${e.message}` });
      encerrarConversa(null);
    },
    aoFim: () => {
      ouvindo = null;
      // Se nada tomou a frente (resposta em curso ou encerramento), volta a
      // ouvir. É o que faz disto uma conversa e não um walkie-talkie.
      if (modoConversa && $("perguntar")?.dataset.estado === ESTADO_CONVERSA.OUVINDO) {
        quandoCalar(() => escutarTurno());
      }
    },
  });

  // Navegador sem reconhecimento de fala: não adianta insistir.
  if (!ouvindo) { modoConversa = false; marcarConversa(ESTADO_CONVERSA.PARADA); }
}

function abrirConversa() {
  if (modoConversa) { encerrarConversa("Conversa encerrada."); return; }
  unlockAudio();
  modoConversa = true;
  silenciosSeguidos = 0;
  conversa.limpar();
  escutarTurno();
}

/**
 * Fecha tudo: microfone, estado e rótulo. Esta função é a rede de segurança
 * do botão — qualquer caminho de saída passa por aqui, então não existe mais
 * o estado "Ouvindo…" preso para sempre que apareceu no teste do celular.
 */
function encerrarConversa(aviso) {
  modoConversa = false;
  silenciosSeguidos = 0;
  const atual = ouvindo;
  ouvindo = null;
  try { atual?.cancelar(); } catch { /* já fechou */ }
  marcarConversa(ESTADO_CONVERSA.PARADA);
  // Vibração diferente da de abrir o microfone: é o único jeito de quem não
  // enxerga distinguir "comecei a ouvir" de "parei de ouvir" sem esperar a fala.
  signal(true);
  if (aviso) dizer(aviso, Canal.SISTEMA, { interrompe: true, daConversa: true, chave: `conversa:${aviso}` });
}

/** Depois de responder, volta a ouvir — a não ser que a conversa tenha acabado. */
function continuarConversa() {
  if (!modoConversa) return;
  quandoCalar(() => escutarTurno());
}

async function responderFala(texto) {
  const c = interpretarComando(texto);
  if (!c) { continuarConversa(); return; }
  diario.alerta({ text: `[voz] ${c.acao}`, tipo: "voz", priority: Priority.BAIXA });

  // Encerrar sai antes de tudo: é a única resposta que não volta a ouvir.
  if (c.acao === Acao.ENCERRAR) { encerrarConversa("Certo. Toque em conversar quando precisar."); return; }

  try { await executarComando(c); }
  finally { continuarConversa(); }
}

async function executarComando(c) {
  const falar = (t, extra = {}) =>
    dizer(t, Canal.SISTEMA, { interrompe: true, daConversa: true, ...extra });

  switch (c.acao) {
    case Acao.SOCORRO: return pedirSocorro();
    case Acao.ONDE_ESTOU: return ondeEstou();
    case Acao.DESCREVER:
      if (state !== "ativo") { falar("Toque em Iniciar para eu ligar a câmera, e pergunte de novo."); return; }
      return describe();
    case Acao.LER: return lerTexto();
    case Acao.IR: return iniciarNavegacao(c.destino);
    case Acao.PARAR_ROTA:
      if (navegador.ativo) return pararNavegacao(true);
      falar("Não há rota em andamento.");
      return;
    case Acao.REPETIR:
      falar(ultimaFalaImportante ?? "Ainda não falei nada para repetir.", { chave: `repete:${Date.now()}` });
      return;
    case Acao.AJUDA:
      falar(AJUDA_FALADA, { validadeMs: 20000 });
      return;
    default:
      return perguntarIA(c.texto);
  }
}

async function perguntarIA(pergunta) {
  if (state !== "ativo") {
    dizer("Para eu olhar e responder, toque em Iniciar e aponte a câmera. Depois pergunte de novo.",
      Canal.SISTEMA, { interrompe: true, daConversa: true });
    return;
  }
  if (!prefs.nuvemLigada || !nuvem.configurado) {
    // Sem a IA na nuvem, ainda dá para ajudar: o que o aparelho vê sozinho.
    dizer("Para perguntas livres sobre a imagem, ligue a descrição detalhada nos ajustes. "
      + "Por enquanto, digo o que vejo.", Canal.SISTEMA, { interrompe: true, daConversa: true });
    describe();
    return;
  }
  dizer("Olhando.", Canal.SISTEMA, { interrompe: true, daConversa: true, chave: "voz:olhando" });
  const agora = performance.now();
  try {
    const { texto, ms } = await nuvem.perguntar(video, pergunta, {
      historico: conversa.historico(agora),
      contexto: contextoLocal({
        objetos: ultimosObjetos, piso: pisoAtual?.nome ?? null,
        navegando: navegador.ativo ? rotaAtual?.destino?.nome ?? null : null,
        local: ultimoOndeEstou?.endereco ?? null,
      }),
    });
    conversa.registrar(pergunta, texto, performance.now());
    dizer(texto, Canal.DESCRICAO, { interrompe: true, daConversa: true, validadeMs: 30000, chave: `resp:${Date.now()}` });
    mostrar("Resposta", "info", texto);
    diario.descricao(`[pergunta] ${texto}`);
    barramento.publicar(Evento.DESCRICAO, { texto, origem: "conversa", ms });
  } catch (e) {
    diario.falha("conversa", e);
    dizer(e.message, Canal.SISTEMA, { interrompe: true, daConversa: true });
  }
}

$("perguntar")?.addEventListener("click", abrirConversa);

// Sair do app, trocar de aba ou bloquear a tela com o microfone aberto deixava
// o botão preso em "Ouvindo…". Agora a conversa fecha junto.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && modoConversa) encerrarConversa(null);
});

marcarConversa(ESTADO_CONVERSA.PARADA);

// ---------------- Onde estou? ----------------
// Situa antes de guiar: rua, confiança do GPS, para onde a pessoa está
// virada, referências do mapa com lado e distância e, com a câmera ligada,
// o que está à frente. É a pergunta que vem antes de "como chego lá".

async function reconhecerLugar(pos) {
  if (state !== "ativo" || !memoriaLugares.tamanho) return null;
  try {
    const vetores = await embedder.varios(video, 3, 250);
    return vetores.length ? memoriaLugares.reconhecerVarios(vetores, pos) : null;
  } catch (e) {
    diario.falha("lugares", e);
    return null;
  }
}

async function ondeEstou() {
  if (localizando) return;
  localizando = true;
  unlockAudio();
  signal(false);
  dizer("Localizando você.", Canal.SISTEMA, { interrompe: true });
  mostrar("Localizando…", "info");

  try {
    // Bússola (1,5 s de espera) e GPS em paralelo. A bússola precisa nascer
    // dentro deste toque no iPhone, e é este o toque.
    const [temBussola, posR] = await Promise.all([
      bussola.iniciar().catch(() => false),
      rastreador.umaVez().then((p) => ({ p }), (e) => ({ e })),
    ]);
    const pos = posR.p ?? null;
    const familiar = await reconhecerLugar(pos);
    const rumoPessoa = temBussola && bussola.graus != null ? bussola.graus : (pos?.rumoGraus ?? null);

    let texto;
    if (pos) {
      const r = await consultarOndeEstou(pos, {
        rumoPessoa, familiar: familiar?.nome ?? null, anterior: ultimoOndeEstou,
      });
      ultimoOndeEstou = r.estado;
      texto = r.texto;
      barramento.publicar(Evento.LOCALIZACAO, {
        endereco: r.endereco, referencias: r.referencias.map((x) => x.tipo),
        familiar: familiar?.nome ?? null, precisaoM: pos.precisaoM ?? null,
      });
    } else {
      // Sem GPS (dentro de casa, permissão negada) ainda pode haver o lugar
      // reconhecido pela câmera — e é justamente o caso em que ele mais vale.
      texto = [familiar ? `Este lugar parece ser ${familiar.nome}.` : null, posR.e?.message].filter(Boolean).join(" ");
    }

    if (state === "ativo") {
      prefixoDescricao = texto;
      describe();
    } else {
      const fim = " Para eu descrever o que está à sua frente, toque em Iniciar e aponte a câmera.";
      dizer(texto + fim, Canal.DESCRICAO, { interrompe: true, validadeMs: 30000 });
      mostrar("Onde estou", "info", texto);
      diario.descricao(texto);
    }
  } catch (e) {
    diario.falha("onde-estou", e);
    dizer("Não consegui me localizar agora. Tente de novo em alguns segundos.", Canal.SISTEMA, { interrompe: true });
  } finally {
    localizando = false;
  }
}

function atualizarListaLugares() {
  const el = $("listaLugares");
  if (!el) return;
  const nomes = memoriaLugares.nomes();
  el.textContent = nomes.length ? `Memorizados: ${nomes.join(", ")}.` : "Nenhum lugar memorizado ainda.";
}

async function memorizarLugar() {
  const nome = ($("campoNomeLugar")?.value ?? "").trim();
  unlockAudio();
  if (!nome) { speak("Escreva ou dite o nome do lugar primeiro.", true); return; }
  if (state !== "ativo") { speak("Inicie a câmera e aponte para o lugar.", true); return; }
  if (memorizando) return;
  memorizando = true;
  try {
    speak(`Memorizando ${nome}. Gire o celular devagar, de um lado para o outro.`, true);
    const pos = await rastreador.umaVez().catch(() => null);
    const vetores = await embedder.varios(video, 8, 400);
    if (!vetores.length) throw new Error("a câmera não entregou imagem");
    const total = await memoriaLugares.ensinar(nome, vetores, pos);
    atualizarListaLugares();
    speak(`Pronto. ${nome} memorizado, com ${total} vistas. Quanto mais vezes você memorizar, melhor eu reconheço.`, true);
  } catch (e) {
    diario.falha("lugares", e);
    speak(`Não consegui memorizar: ${e.message}.`, true);
  } finally {
    memorizando = false;
  }
}

registrarProvedorDeLugares(memoriaLugares.comoProvedor());
memoriaLugares.carregar().then(atualizarListaLugares, () => {});
$("ondeEstou").addEventListener("click", ondeEstou);
$("memorizarLugar").addEventListener("click", memorizarLugar);
$("esquecerLugares").addEventListener("click", async () => {
  await memoriaLugares.esquecerTodos().catch(() => {});
  atualizarListaLugares();
  speak("Todos os lugares foram esquecidos.", true);
});

// ---------------- Eventos da navegação ----------------
nuvem.endpoint = prefs.endpointNuvem;
atualizarPainelNav();

btnIr.addEventListener("click", () => {
  unlockAudio();
  campoDestino.value = "";
  dlgDestino.showModal();
  // Dar o foco ao campo faz o leitor de tela anunciar o rótulo e abre o
  // teclado: sem isso, quem usa VoiceOver fica procurando onde digitar.
  setTimeout(() => campoDestino.focus(), 120);
});

$("formDestino").addEventListener("submit", (e) => {
  e.preventDefault();
  const texto = campoDestino.value;
  dlgDestino.close();
  iniciarNavegacao(texto);
});

// Sem type="button" o Cancelar também é submit, e cancelar viraria "ir".
$("cancelarDestino").addEventListener("click", () => dlgDestino.close());

$("ditar").addEventListener("click", () => {
  mostrar("Escutando o destino…", "info");
  ditarDestino({
    aoOuvir: (texto) => {
      campoDestino.value = texto;
      mostrar(`Entendi: ${texto}`, "info");
      speak(`Entendi ${texto}. Toque em traçar rota para confirmar.`, true);
    },
    aoFalhar: (err) => { mostrar(err.message, "info"); speak(err.message, true); },
  });
});

btnPararRota.addEventListener("click", () => pararNavegacao(true));

const chkPiso = $("chkPiso");
const chkValidando = $("chkValidando");
chkPiso.checked = prefs.piso;
chkValidando.checked = prefs.validando;
document.body.dataset.validando = String(prefs.validando);

chkPiso.addEventListener("change", () => {
  prefs.piso = chkPiso.checked;
  if (prefs.piso && prefs.aberto) {
    prefs.aberto = false;
    chkAberto.checked = false;
    clearInterval(varreduraTimer); varreduraTimer = 0;
    riscosAbertos = []; detectorAberto.descarregar();
    speak("Desliguei o reconhecimento ampliado: ele e o aviso de calçada não cabem "
      + "juntos na memória do celular.", true);
  }
  salvarPrefs();
  if (!prefs.piso) { clearInterval(segTimer); segTimer = 0; pisoEl.textContent = ""; pisoAtual = null; }
  else if (state === "ativo") iniciarPiso();
});

const selVerbosidade = $("selVerbosidade");
const selModelo = $("selModelo");
selVerbosidade.value = String(prefs.verbosidade);
selModelo.value = prefs.modelo;

selVerbosidade.addEventListener("change", () => {
  prefs.verbosidade = Number(selVerbosidade.value);
  salvarPrefs();
  ambiente.reset();
  const nomes = ["Só perigos.", "Perigos e objetos em volta.", "Tudo o que reconhecer."];
  speak(nomes[prefs.verbosidade] ?? "Ajustado.", true);
});

selModelo.addEventListener("change", async () => {
  prefs.modelo = selModelo.value;
  salvarPrefs();
  // o detector carrega o modelo na criação: precisa ser refeito
  const estavaAtivo = state === "ativo";
  try { detector?.close?.(); } catch { /* já fechado */ }
  detector = null;
  speak("Trocando o modelo de reconhecimento.", true);
  if (estavaAtivo) { stop(false); await start(); }
});

chkValidando.addEventListener("change", () => {
  prefs.validando = chkValidando.checked;
  salvarPrefs();
  document.body.dataset.validando = String(prefs.validando);
  speak(prefs.validando ? "Modo validação ligado." : "Modo validação desligado.", true);
});

// ---------------- Ajustes novos ----------------
const chkAberto = $("chkAberto");
const chkNuvem = $("chkNuvem");
const campoChave = $("campoChaveGoogle");
const campoEndpoint = $("campoEndpointNuvem");

chkAberto.checked = prefs.aberto;
chkNuvem.checked = prefs.nuvemLigada;
const campoContato = $("campoContatoSocorro");
const selSocorro = $("selSocorroModo");
campoContato.value = prefs.contatoSocorro;
selSocorro.value = prefs.socorroModo;
campoContato.addEventListener("change", () => { prefs.contatoSocorro = campoContato.value.trim(); salvarPrefs(); });
selSocorro.addEventListener("change", () => { prefs.socorroModo = selSocorro.value; salvarPrefs(); });
campoChave.value = prefs.chaveGoogle;
campoEndpoint.value = prefs.endpointNuvem;
$("contaVocabulario").textContent =
  `${VOCABULARIO.length} tipos de obstáculo e risco que o detector comum não conhece.`;

chkAberto.addEventListener("change", () => {
  if (!chkAberto.checked) {
    prefs.aberto = false;
    salvarPrefs();
    clearInterval(varreduraTimer); varreduraTimer = 0;
    riscosAbertos = []; detectorAberto.descarregar();
    speak("Reconhecimento ampliado desligado.", true);
    return;
  }

  // Aparelho pequeno demais: recusamos antes de baixar 90 MB para depois
  // derrubar a aba. Dizer não agora é melhor do que falhar depois.
  if (!memoriaBastaParaAberto()) {
    chkAberto.checked = false;
    prefs.aberto = false;
    salvarPrefs();
    speak(`Este aparelho declara ${MEMORIA_GB} gigabytes de memória. O reconhecimento `
      + "ampliado precisa de pelo menos quatro e derrubaria o aplicativo. Mantive desligado.", true);
    return;
  }

  // Três modelos ao mesmo tempo é o que mata a aba. O piso e o ampliado
  // disputam a mesma memória, então um desliga o outro.
  let avisoPiso = "";
  if (prefs.piso) {
    prefs.piso = false;
    chkPiso.checked = false;
    clearInterval(segTimer); segTimer = 0;
    pisoEl.textContent = ""; pisoAtual = null;
    avisoPiso = " Desliguei o aviso de calçada, porque os dois juntos não cabem na memória do celular.";
  }

  prefs.aberto = true;
  salvarPrefs();
  speak("Reconhecimento ampliado ligado. O modelo baixa na primeira vez que você pedir "
    + "uma descrição; use rede sem fio." + avisoPiso, true);
});

campoChave.addEventListener("change", () => {
  prefs.chaveGoogle = campoChave.value.trim();
  salvarPrefs();
  speak(prefs.chaveGoogle
    ? "Chave do Google Maps salva."
    : "Chave removida. A navegação vai usar o OpenStreetMap.", true);
});

campoEndpoint.addEventListener("change", () => {
  prefs.endpointNuvem = campoEndpoint.value.trim();
  nuvem.endpoint = prefs.endpointNuvem;
  salvarPrefs();
});

// Consentimento em dois toques, com o aviso FALADO. Quem não enxerga não lê
// o rótulo da chave nem o termo de uso; um toque acidental não pode começar a
// mandar fotos do que a pessoa aponta para um servidor.
let consentimentoAte = 0;
chkNuvem.addEventListener("change", () => {
  if (!chkNuvem.checked) {
    prefs.nuvemLigada = false; salvarPrefs();
    speak("Descrição detalhada desligada. Nenhuma imagem sai do aparelho.", true);
    return;
  }
  const agora = Date.now();
  if (agora < consentimentoAte) {
    prefs.nuvemLigada = true; salvarPrefs();
    consentimentoAte = 0;
    speak("Descrição detalhada ligada. A partir de agora, o botão O que tem aqui envia uma foto.", true);
    return;
  }
  chkNuvem.checked = false;          // ainda não: primeiro o aviso
  consentimentoAte = agora + 30000;
  speak(AVISO_DE_CONSENTIMENTO, true);
  mostrar("Toque de novo para confirmar a descrição detalhada.", "texto", AVISO_DE_CONSENTIMENTO);
});

$("testarVoz").addEventListener("click", testarVoz);

$("exportar").addEventListener("click", () => {
  if (!diario.sessao) { speak("Ainda não há sessão para exportar.", true); return; }
  const r = diario.exportar();
  speak(`Diário exportado. ${r.alertas} avisos nesta sessão.`, true);
});

$("limparDiario").addEventListener("click", () => {
  diario.limpar();
  $("resumoDiario").textContent = "Diário apagado.";
  speak("Diário apagado.", true);
});

atualizarResumo();

// ---------------- Diagnóstico de memória ----------------
// A queda por memória é invisível para quem está testando: a aba some e volta
// uma página de erro do navegador. Esta linha, nos ajustes, é o que permite ao
// piloto relatar o que aconteceu em vez de dizer só "caiu".
function atualizarDiagMemoria() {
  const partes = [];
  partes.push(MEMORIA_GB !== null
    ? `Memória declarada pelo aparelho: ${MEMORIA_GB} GB.`
    : "O navegador não informa a memória do aparelho.");
  partes.push(`Núcleos: ${navigator.hardwareConcurrency ?? "?"}.`);
  const pesados = [prefs.modelo === "lite2" && "precisão alta",
    prefs.piso && "calçada", prefs.aberto && "ampliado"].filter(Boolean);
  partes.push(`Modelos ligados: ${pesados.length ? pesados.join(", ") : "só o básico"}.`);
  if (marcaAnterior) {
    partes.push(`A sessão anterior foi encerrada pelo navegador durante `
      + `"${marcaAnterior.etapa}" — quase sempre falta de memória.`);
  }
  $("diagMemoria").textContent = partes.join(" ");
}
atualizarDiagMemoria();

// O aviso de queda aparece na tela antes de qualquer toque.
if (avisoDeQueda) mostrar("O aplicativo caiu na sessão anterior", "alta", avisoDeQueda);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Service worker não registrado", e));
}
