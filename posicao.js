// Onde a pessoa está e para onde ela aponta.
//
// Duas fontes com qualidades muito diferentes:
//
//   GPS — sabe o lugar (com 5 a 20 m de erro na cidade) e sabe o rumo apenas
//   quando a pessoa está andando. Parada, o "curso" do GPS é lixo: ele gira
//   sozinho porque a posição treme.
//
//   Bússola — sabe o rumo mesmo parada, que é justamente o momento em que o
//   GPS não sabe. Em compensação sofre com metal, ímã de bolsa e carcaça, e no
//   iPhone precisa de permissão pedida DENTRO de um toque do usuário.
//
// Juntas resolvem o caso que mais importa: a pessoa parada na esquina,
// perguntando "para que lado eu vou?".

export class RastreadorDePosicao {
  constructor({ aoMover, aoFalhar } = {}) {
    this.aoMover = aoMover;
    this.aoFalhar = aoFalhar;
    this.id = null;
    this.ultima = null;
  }

  get ativo() { return this.id !== null; }

  iniciar() {
    if (this.id !== null) return true;
    if (!navigator.geolocation) {
      this.aoFalhar?.(new Error("este navegador não tem localização"));
      return false;
    }
    this.id = navigator.geolocation.watchPosition(
      (p) => {
        this.ultima = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          precisaoM: p.coords.accuracy ?? null,
          // heading vem em graus, ou NaN/null quando o aparelho está parado
          rumoGraus: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
          velocidadeMs: Number.isFinite(p.coords.speed) ? p.coords.speed : 0,
          ts: p.timestamp,
        };
        this.aoMover?.(this.ultima);
      },
      (e) => {
        const msg = e.code === e.PERMISSION_DENIED
          ? "Permissão de localização negada. Sem ela não há navegação."
          : e.code === e.POSITION_UNAVAILABLE
            ? "Não consegui o sinal de GPS. Tente a céu aberto."
            : "A localização demorou demais a responder.";
        this.aoFalhar?.(new Error(msg));
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
    return true;
  }

  parar() {
    if (this.id === null) return;
    navigator.geolocation.clearWatch(this.id);
    this.id = null;
  }

  /** Uma leitura só, para traçar a rota antes de começar a seguir. */
  umaVez(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (this.ultima && Date.now() - this.ultima.ts < 10000) { resolve(this.ultima); return; }
      if (!navigator.geolocation) { reject(new Error("este navegador não tem localização")); return; }
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({
          lat: p.coords.latitude, lng: p.coords.longitude,
          precisaoM: p.coords.accuracy ?? null, rumoGraus: null, velocidadeMs: 0, ts: p.timestamp,
        }),
        (e) => reject(new Error(e.code === e.PERMISSION_DENIED
          ? "Permissão de localização negada."
          : "Não consegui a sua posição.")),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 5000 },
      );
    });
  }
}

// ============================================================
// Bússola
// ============================================================

export class Bussola {
  constructor({ aoGirar } = {}) {
    this.aoGirar = aoGirar;
    this.graus = null;
    this.disponivel = false;
    this.handler = null;
    // A leitura crua pula vários graus entre eventos. Uma média circular curta
    // tira o tremor sem criar atraso perceptível.
    this.sx = 0;
    this.sy = 0;
  }

  /**
   * Precisa ser chamado DENTRO de um gesto do usuário no iPhone, senão o
   * requestPermission é recusado sem nem mostrar o diálogo.
   */
  async iniciar() {
    if (this.handler) return this.disponivel;
    const D = window.DeviceOrientationEvent;
    if (!D) return false;

    if (typeof D.requestPermission === "function") {
      try {
        if (await D.requestPermission() !== "granted") return false;
      } catch { return false; }
    }

    this.handler = (e) => {
      // webkitCompassHeading já vem em graus do norte verdadeiro, sentido
      // horário. O `alpha` padrão é o contrário e relativo: precisa inverter.
      let g = null;
      if (typeof e.webkitCompassHeading === "number" && !Number.isNaN(e.webkitCompassHeading)) {
        g = e.webkitCompassHeading;
      } else if (typeof e.alpha === "number" && e.absolute !== false) {
        g = (360 - e.alpha) % 360;
      }
      if (g == null) return;

      const r = (g * Math.PI) / 180;
      const a = 0.25;
      this.sx = this.sx * (1 - a) + Math.cos(r) * a;
      this.sy = this.sy * (1 - a) + Math.sin(r) * a;
      this.graus = (Math.atan2(this.sy, this.sx) * 180 / Math.PI + 360) % 360;
      this.disponivel = true;
      this.aoGirar?.(this.graus);
    };

    window.addEventListener("deviceorientationabsolute", this.handler, true);
    window.addEventListener("deviceorientation", this.handler, true);

    // Se em 1,5 s nenhum evento útil chegou, não há bússola de verdade aqui.
    await new Promise((r) => setTimeout(r, 1500));
    return this.disponivel;
  }

  parar() {
    if (!this.handler) return;
    window.removeEventListener("deviceorientationabsolute", this.handler, true);
    window.removeEventListener("deviceorientation", this.handler, true);
    this.handler = null;
    this.disponivel = false;
    this.graus = null;
  }
}

// ============================================================
// Ditado do destino
// ============================================================
// Digitar endereço em tela sensível ao toque, sem ver, é lento e dá erro.
// Falar é o caminho natural. O reconhecimento de fala do navegador não existe
// em todo lugar, então o campo de texto continua valendo — isto é um atalho,
// nunca o único jeito.

export function ditarDestino({ aoOuvir, aoFalhar } = {}) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { aoFalhar?.(new Error("este navegador não escuta ditado")); return null; }
  const rec = new R();
  rec.lang = "pt-BR";
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => aoOuvir?.(e.results[0][0].transcript);
  rec.onerror = (e) => aoFalhar?.(new Error(
    e.error === "not-allowed" ? "Permissão de microfone negada." : "Não entendi o destino.",
  ));
  try { rec.start(); } catch { /* já estava ouvindo */ }
  return rec;
}
