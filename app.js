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
import { Navegador, referenciaNoLado, distanciaFalada } from "./navegacao.js";
import { tracarRota } from "./rotas.js";
import { RastreadorDePosicao, Bussola, ditarDestino } from "./posicao.js";
import {
  DetectorAberto, nomesDoVocabulario, rotulosDeRisco, ALTURAS_ABERTAS, VOCABULARIO,
} from "./aberto.js";
import { DescritorNaNuvem, contextoLocal, AVISO_DE_CONSENTIMENTO } from "./nuvem.js";
import { barramento, Evento, registroDeRisco, buscarEmProvedores } from "./integracao.js";

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
const bussola = new Bussola();
let rotaAtual = null;
let destinoAtual = "";
let recalculando = false;

// Vocabulário aberto e descrição na nuvem
const detectorAberto = new DetectorAberto();
const nuvem = new DescritorNaNuvem();
let varreduraTimer = 0;
let riscosAbertos = [];          // detecções abertas ainda válidas
let riscosAteMs = 0;

// ---------------- Preferências ----------------
const PREFS = "iris.prefs.v3";   // v3 acrescenta navegação, vocabulário e nuvem
const prefs = Object.assign(
  // Padrão leve: três modelos de IA ao mesmo tempo estouravam a memória do
  // Safari e o app era encerrado. Piso e Lite2 ficam como opção consciente.
  // A nuvem nasce desligada por princípio, não por desempenho.
  {
    piso: false, validando: false, verbosidade: Verbosidade.NORMAL, modelo: "lite0",
    aberto: false, chaveGoogle: "", nuvemLigada: false, endpointNuvem: "/api/descrever",
  },
  (() => { try { return JSON.parse(localStorage.getItem(PREFS) ?? "{}"); } catch { return {}; } })()
);
const salvarPrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* modo privado */ } };

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
  const entrou = fila.oferecer({ texto, canal, ...extra }, performance.now());
  if (entrou) bombearFala();
  return entrou;
}

const NIVEL_DO_CANAL = {
  [Canal.ALERTA]: "alta", [Canal.NAVEGACAO]: "nav", [Canal.SISTEMA]: "info",
  [Canal.DESCRICAO]: "info", [Canal.NARRACAO]: "info",
};

function bombearFala() {
  const s = window.speechSynthesis;
  const ocupada = Boolean(s?.speaking || s?.pending);
  const saida = fila.proxima(performance.now(), ocupada);
  if (!saida) return;
  speak(saida.texto, saida.interromper);
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
  barramento.publicar(Evento.SESSAO_INICIOU, { modelo: prefs.modelo, piso: prefs.piso });
  await requestWakeLock();
  setState("ativo", "Percepção ativa");
  speak("Percepção iniciada.", true);
  rafId = requestAnimationFrame(tick);

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
  objects = motion.update(objects, ts);
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

  const alert = alerts.process(objects, ts);
  if (alert) {
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
  });

  // Camada 3 primeiro, quando ligada: ela substitui as outras, não soma.
  // Duas descrições da mesma cena, uma atrás da outra, é o oposto do que se
  // quer de um app que já fala demais.
  if (prefs.nuvemLigada && nuvem.configurado) {
    rotulo.textContent = "Enviando…";
    mostrar("Enviando uma foto para a descrição detalhada…", "info");
    try {
      const { texto, ms } = await nuvem.descrever(video, contexto);
      rotulo.textContent = "O que tem aqui?";
      dizer(texto, Canal.DESCRICAO, { interrompe: true, validadeMs: 20000 });
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
  dizer(texto, Canal.DESCRICAO, { interrompe: true, validadeMs: 15000 });
  mostrar("Descrição do ambiente", "info", texto);
  diario.descricao(texto);
  barramento.publicar(Evento.DESCRICAO, { texto, origem: "local" });
}

// ---------------- Vocabulário aberto ----------------
// Caro demais para o laço de quadros (1 a 4 s por passada), então roda sob
// demanda e, durante a navegação, em varreduras espaçadas do chão à frente.

const VALIDADE_RISCO_MS = 6000;   // buraco não anda, mas a câmera vira

async function varrerVocabularioAberto({ descricao = false } = {}) {
  if (!prefs.aberto || state !== "ativo") return null;
  try {
    if (!detectorAberto.pronto) {
      mostrar("Preparando o reconhecimento ampliado (uma vez só).", "info");
      await detectorAberto.carregar();
    }
    const r = await detectorAberto.varrer(video);
    if (!r) return null;

    riscosAbertos = r.deteccoes;
    riscosAteMs = performance.now() + VALIDADE_RISCO_MS;
    diario.metrica({ varreduraMs: r.ms, riscos: r.deteccoes.length });

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
    for (const d of r.deteccoes) porNome.set(d.pt, (porNome.get(d.pt) ?? 0) + 1);
    const itens = [...porNome.entries()].slice(0, 4)
      .map(([nome, n]) => (n === 1 ? nome : `${numero(n, false)} ${nome}`));
    return `No chão e em volta: ${itens.join(", ")}.`;
  } catch (e) {
    diario.falha("vocabulario-aberto", e);
    return null;
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
    if (ev.recalcular) { recalcularRota(); continue; }

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
    const inicio = navegador.iniciar(rotaAtual);
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
btnToggle.addEventListener("click", () => (state === "parado" ? start() : stop()));
btnDescrever.addEventListener("click", describe);
btnLerTexto.addEventListener("click", lerTexto);
$("errou").addEventListener("click", () => relatar(TipoErro.FALSO_POSITIVO, "Aviso errado marcado."));
$("perdeu").addEventListener("click", () => relatar(TipoErro.NAO_AVISOU, "Obstáculo não avisado, marcado."));

$("abrirAjustes").addEventListener("click", () => { atualizarResumo(); dlgAjustes.showModal(); });

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
campoChave.value = prefs.chaveGoogle;
campoEndpoint.value = prefs.endpointNuvem;
$("contaVocabulario").textContent =
  `${VOCABULARIO.length} tipos de obstáculo e risco que o detector comum não conhece.`;

chkAberto.addEventListener("change", () => {
  prefs.aberto = chkAberto.checked;
  salvarPrefs();
  if (!prefs.aberto) {
    clearInterval(varreduraTimer); varreduraTimer = 0;
    riscosAbertos = []; detectorAberto.descarregar();
    speak("Reconhecimento ampliado desligado.", true);
  } else {
    speak("Reconhecimento ampliado ligado. O modelo baixa na primeira vez que você pedir uma descrição.", true);
  }
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

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("Service worker não registrado", e));
}
