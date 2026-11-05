// Projeto Íris — percepção do ambiente no navegador.
// Detecção de objetos (MediaPipe + EfficientDet-Lite0), segmentação do piso
// (SegFormer-B0 / ADE20K) e leitura de texto (Tesseract) rodando no próprio
// aparelho. Nenhuma imagem sai daqui.

import {
  analyzeSpatial, AlertEngine, describeScene, Priority, Proximity, NOMES,
  MotionTracker, corDoSemaforo, analisarPiso, obstaculosDoPiso, avisoDePiso,
  Narrador, Verbosidade,
} from "./core.js";
import { amostrarSemaforo, Segmentador } from "./vision.js";
import { Leitor } from "./ocr.js";
import { Diario, TipoErro } from "./diario.js";

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

// ---------------- Preferências ----------------
const PREFS = "iris.prefs.v2";   // v2 reseta todo mundo para o padrão leve
const prefs = Object.assign(
  // Padrão leve: três modelos de IA ao mesmo tempo estouravam a memória do
  // Safari e o app era encerrado. Piso e Lite2 ficam como opção consciente.
  { piso: false, validando: false, verbosidade: Verbosidade.NORMAL, modelo: "lite0" },
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
  narrador.reset();
  describeLeft = 0;
  describeBuffer = [];
  lastFrameAt = 0;
  fps = 0;
  pisoAtual = null;
  pisoAnterior = null;
  ultimoAvisoPiso.clear();
  segIntervaloAtual = SEG_INTERVALO_MS;

  diario.iniciar({ piso: prefs.piso, validando: prefs.validando });
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
      speak(aviso.text, alta);
      mostrar(aviso.text, alta ? "alta" : "info");
      diario.alerta({ text: aviso.text, priority: aviso.priority, key: `piso:${novo.nome}` });
    }
  }

  // degrau e poste: o detector de objetos não vê nenhum dos dois
  for (const obs of obstaculosDoPiso(r.contagens, r.totalPixels)) {
    if (!podeAvisarPiso(`obs:${obs.nome}`)) continue;
    const texto = `Atenção, ${obs.nome} à frente.`;
    signal(true);
    speak(texto, true);
    mostrar(texto, "alta");
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
  setState("parado", "Parado. Toque em Iniciar para começar.");
  if (announce && wasActive) speak("Percepção parada.", true);
}

// ---------------- Laço de detecção ----------------
const clamp = (v) => Math.min(1, Math.max(0, v));

function tick(now) {
  if (state !== "ativo") return;
  if (now - lastFrameAt >= 1000 / MAX_FPS && video.readyState >= 2) {
    try { processFrame(now); } catch (e) { console.error("Falha no quadro", e); diario.falha("quadro", e); }
  }
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

  let objects = analyzeSpatial(detections);
  objects = motion.update(objects, ts);

  // cor do semáforo: o COCO detecta o poste, não a luz acesa
  for (const o of objects) {
    if (o.detection.label !== "traffic light") continue;
    const r = corDoSemaforo(amostrarSemaforo(video, o.detection.box));
    if (r) o.cor = r.cor;
  }
  ultimosObjetos = objects;

  const alert = alerts.process(objects, ts);
  if (alert) {
    const high = alert.priority === Priority.ALTA;
    signal(high);
    speak(alert.text, high);
    mostrar(alert.text, high ? "alta" : "info");
    diario.alerta(alert);
  } else if (describeLeft === 0 && !lendoTexto) {
    // sem perigo a anunciar: conta o que apareceu e o que está acontecendo
    const ev = narrador.evento(objects, ts, prefs.verbosidade);
    if (ev) {
      speak(ev.text, false);          // nunca interrompe um alerta em curso
      mostrar(ev.text, "info");
      diario.alerta({ ...ev, priority: Priority.BAIXA });
    }
  }

  if (describeLeft > 0) {
    describeBuffer.push(objects);
    describeLeft--;
    if (describeLeft === 0) {
      let text = describeScene(describeBuffer);
      if (pisoAtual) text = `Você está em ${pisoAtual.nome}. ${text}`;
      describeBuffer = [];
      speak(text, true);
      mostrar("Descrição do ambiente", "info", text);
      diario.descricao(text);
      btnDescrever.querySelector(".rotulo").textContent = "O que tem aqui?";
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

function describe() {
  if (state !== "ativo") { unlockAudio(); speak("Inicie a percepção primeiro.", true); return; }
  signal(false); // confirma o toque
  describeBuffer = [];
  describeLeft = DESCRIBE_FRAMES;
  btnDescrever.querySelector(".rotulo").textContent = "Olhando…";
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
  narrador.reset();
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
