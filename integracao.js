// Costura para integrações — Lumiar e o que vier depois.
//
// Hoje o Íris é um app fechado: o que ele percebe morre na sessão. Isso basta
// para o piloto e não basta para o que vem a seguir. Um exemplo concreto do
// que esta camada destrava: se o Lumiar conhece os pontos culturais da cidade,
// o Íris pode aceitar "me leve ao Museu" como destino e, ao chegar, anunciar
// o que aquele ponto oferece de acessibilidade. E se o Íris publica onde seus
// usuários encontram calçada quebrada, isso vira dado de política pública.
//
// O desenho tem uma regra só, e ela é de privacidade: NADA sai daqui por
// iniciativa deste módulo. Ele publica eventos para quem se inscreveu dentro
// do próprio aparelho. Mandar qualquer coisa para a rede é decisão de um
// adaptador, que precisa de consentimento explícito e falado, como o da
// descrição na nuvem. Sem adaptador registrado, este arquivo não faz nada
// além de guardar funções numa lista.

export const Evento = {
  SESSAO_INICIOU: "sessao:iniciou",
  SESSAO_TERMINOU: "sessao:terminou",
  ALERTA: "percepcao:alerta",
  DESCRICAO: "percepcao:descricao",
  PISO: "percepcao:piso",
  RISCO_ABERTO: "percepcao:risco",      // buraco, bueiro, tapume: o que vira dado público
  NAV_INICIOU: "nav:iniciou",
  NAV_MANOBRA: "nav:manobra",
  NAV_FORA_DE_ROTA: "nav:fora",
  NAV_CHEGOU: "nav:chegou",
  ERRO_MARCADO: "piloto:erro",          // o testador marcou falso positivo ou falha
};

export class Barramento {
  constructor() { this.inscritos = new Map(); }

  /** Devolve a função que cancela a inscrição. */
  em(evento, fn) {
    if (!this.inscritos.has(evento)) this.inscritos.set(evento, new Set());
    this.inscritos.get(evento).add(fn);
    return () => this.inscritos.get(evento)?.delete(fn);
  }

  /**
   * Publica. Um adaptador que explode não pode derrubar o laço de percepção:
   * quem está atravessando a rua depende dele.
   */
  publicar(evento, dados) {
    for (const fn of this.inscritos.get(evento) ?? []) {
      try { fn({ evento, ts: Date.now(), ...dados }); }
      catch (e) { console.warn(`Adaptador falhou em ${evento}`, e); }
    }
  }

  limpar() { this.inscritos.clear(); }
}

export const barramento = new Barramento();

// ============================================================
// Provedores de lugares
// ============================================================
// O campo de destino hoje consulta o Google e o OpenStreetMap. Um provedor
// registrado entra ANTES dos dois: quando o Lumiar souber responder "Museu
// Rondon", a resposta dele vale mais do que a de um buscador genérico, porque
// vem com o que interessa — entrada acessível, piso tátil, horário.

const provedores = [];

/**
 * provedor: {
 *   nome: string,
 *   buscar(texto, { lat, lng }): Promise<[{ nome, lat, lng, detalhe?, acessibilidade? }]>
 * }
 */
export function registrarProvedorDeLugares(provedor) {
  if (typeof provedor?.buscar !== "function") throw new Error("provedor sem buscar()");
  provedores.push(provedor);
  return () => {
    const i = provedores.indexOf(provedor);
    if (i >= 0) provedores.splice(i, 1);
  };
}

/** Consulta os provedores registrados. Devolve [] se nenhum souber responder. */
export async function buscarEmProvedores(texto, posicao) {
  const achados = [];
  for (const p of provedores) {
    try {
      const r = await p.buscar(texto, posicao);
      for (const a of r ?? []) achados.push({ ...a, fonte: p.nome });
    } catch (e) {
      console.warn(`Provedor ${p.nome} falhou`, e);
    }
  }
  return achados;
}

// ============================================================
// Contrato do adaptador
// ============================================================
// Escrito como código e não como documento para que o próximo a integrar o
// Lumiar tenha onde se apoiar sem ler o app inteiro.

/**
 * Esqueleto de adaptador. Copie, troque o corpo dos métodos e registre:
 *
 *   const lumiar = new AdaptadorBase("lumiar");
 *   lumiar.ligar(barramento);
 *   registrarProvedorDeLugares(lumiar);
 *
 * O que um adaptador NÃO pode fazer:
 *   - enviar qualquer coisa à rede sem consentimento explícito e falado;
 *   - enviar imagem da câmera (nenhum evento carrega imagem, e isso é proposital);
 *   - bloquear: todo método é chamado dentro do laço de percepção.
 */
export class AdaptadorBase {
  constructor(nome) {
    this.nome = nome;
    this.cancelamentos = [];
  }

  ligar(bus = barramento, eventos = Object.values(Evento)) {
    for (const e of eventos) this.cancelamentos.push(bus.em(e, (d) => this.receber(d)));
    return this;
  }

  desligar() {
    for (const c of this.cancelamentos) c();
    this.cancelamentos = [];
  }

  /** Sobrescreva. Chegou um evento do app. */
  receber(_dados) { /* nada por padrão */ }

  /** Sobrescreva se o adaptador também souber responder destinos. */
  async buscar(_texto, _posicao) { return []; }
}

/**
 * Risco de via encontrado pelo vocabulário aberto, no formato que um sistema
 * de dados públicos consegue consumir. A posição vem do GPS, não da imagem, e
 * a imagem nunca acompanha — é a diferença entre um mapa colaborativo de
 * calçadas e uma câmera de vigilância.
 */
export function registroDeRisco({ classe, confianca, posicao, metros }) {
  return {
    classe,                               // "buraco", "bueiro aberto", ...
    confianca: Number(confianca?.toFixed?.(2) ?? confianca),
    lat: posicao?.lat ?? null,
    lng: posicao?.lng ?? null,
    precisaoM: posicao?.precisaoM ?? null,
    distanciaM: metros ?? null,
    quando: new Date().toISOString(),
    origem: "iris-pwa",
  };
}
