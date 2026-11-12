// Conversa por voz — a pessoa pergunta, o Íris olha e responde.
//
// Até a 0.11 a pessoa apertava botões: "O que tem aqui?", "Ler texto", "Onde
// estou?". Quem não enxerga acha botão pelo tato ou pelo leitor de tela, e
// cada botão a mais é uma coisa a decorar. Falar é o jeito natural:
//
//   "onde eu estou?"                    -> Onde estou (no aparelho)
//   "o que tem na minha frente?"        -> descrição (no aparelho)
//   "lê isso pra mim"                   -> leitura de texto (no aparelho)
//   "me leva até a farmácia"            -> navegação (no aparelho + mapa)
//   "socorro"                           -> SOS
//   "essa nota é de quanto?"            -> pergunta livre: IA de visão
//   "e a cor da camisa?" (em seguida)   -> continua a conversa
//
// Duas camadas, de propósito:
//
//   1. COMANDOS reconhecidos aqui, sem internet e sem mandar imagem. Cobrem o
//      que a pessoa mais faz, funcionam no metrô e no 3G ruim.
//   2. PERGUNTAS LIVRES vão para o modelo de visão-linguagem pelo proxy do
//      projeto — só com a descrição detalhada ligada (consentimento falado),
//      uma foto por pergunta, nunca vídeo. O histórico que viaja é só texto:
//      as fotos anteriores não são reenviadas.
//
// Lógica pura, testada sem navegador: `node --test test/conversa.test.mjs`.

export const Acao = {
  ONDE_ESTOU: "onde-estou",
  DESCREVER: "descrever",
  LER: "ler",
  IR: "ir",
  PARAR_ROTA: "parar-rota",
  SOCORRO: "socorro",
  REPETIR: "repetir",
  AJUDA: "ajuda",
  // Registrar uma barreira de calçada, com a dificuldade que ela causou. É o
  // único caminho possível para quem não enxerga relatar na hora, de pé, no
  // meio da calçada — procurar um botão na tela, ali, não é opção.
  ANOTAR_BARREIRA: "anotar-barreira",
  ENCERRAR: "encerrar",
  PERGUNTA: "pergunta",
};

/** Minúsculas, sem acento, sem pontuação: o reconhecimento de voz varia muito na grafia. */
export function normalizarFala(t) {
  return String(t ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Ordem importa: o primeiro que casar vence. Socorro primeiro, sempre.
const REGRAS = [
  { acao: Acao.SOCORRO, re: /^(socorro|me ajud[ae]+|preciso de (ajuda|socorro)|pedir (ajuda|socorro)|chama a policia|liga (pro|para o) 190)\b/ },
  { acao: Acao.PARAR_ROTA, re: /\b(para|parar|cancela|cancelar|encerra|encerrar) (a )?(rota|navegacao)\b/ },
  { acao: Acao.ONDE_ESTOU, re: /\b(onde (e que )?(eu )?(estou|to|esto)|onde eu to|que (rua|lugar) (e esse|e essa|e este|eu estou)|em que rua)\b/ },
  { acao: Acao.LER, re: /\b(le|ler|leia|lê) (isso|isto|pra mim|para mim|o texto|a placa|o que (esta|ta) escrito)|^(le|leia|ler)$|\bo que (esta|ta) escrito\b/ },
  { acao: Acao.DESCREVER, re: /^(o que (tem|ha) (aqui|na minha frente|a minha frente|em volta|ao redor|a minha volta|na frente)|descreve?r?( (o ambiente|aqui|isso|o lugar))?|o que (voce|vc) (ve|esta vendo))$/ },
  { acao: Acao.REPETIR, re: /^(repete|repetir|repita|fala de novo|o que (voce|vc) disse|nao entendi)$/ },
  { acao: Acao.AJUDA, re: /^(ajuda|o que (voce|vc) (faz|sabe fazer)|quais (sao os )?comandos|como (eu )?uso)$/ },

  // Barreira de calçada. A frase carrega a DIFICULDADE junto, porque é ela que
  // transforma a detecção em denúncia: "havia um tapume" é um dado, "havia um
  // tapume e eu tive que descer para a rua" é uma violação de direito com
  // consequência narrável. Cada regra devolve a dificuldade que ela expressa.
  { acao: Acao.ANOTAR_BARREIRA, dificuldade: "cai",
    re: /\b(eu )?(cai|caí|levei um tombo|cai no chao|cai aqui)\b/ },
  { acao: Acao.ANOTAR_BARREIRA, dificuldade: "tropecei",
    re: /\b(eu )?(tropecei|bati|esbarrei|machuquei o pe|torci o pe)\b/ },
  { acao: Acao.ANOTAR_BARREIRA, dificuldade: "fui_para_rua",
    re: /\b(tive|precisei) (que |de )?(descer|ir) (pra|para) (a )?(rua|pista)|\bdesci (pra|para) (a )?rua\b/ },
  { acao: Acao.ANOTAR_BARREIRA, dificuldade: "nao_passei",
    re: /\b(nao (consegui|deu (pra|para)) passar|tive que voltar|nao da (pra|para) passar|caminho (esta|ta) bloqueado)\b/ },
  { acao: Acao.ANOTAR_BARREIRA, dificuldade: "pedi_ajuda",
    re: /\b(precisei|tive) (de |que )?pedir ajuda|\bpedi ajuda\b/ },
  { acao: Acao.ANOTAR_BARREIRA, dificuldade: "desviei",
    re: /\b(tive|precisei) (que |de )?desviar|\bdesviei\b/ },
  { acao: Acao.ANOTAR_BARREIRA, dificuldade: null,
    re: /\b(anota|anotar|registra|registrar|marca|marcar) (essa |esta |a |uma )?(barreira|calcada|obstaculo|problema|denuncia)\b|\b(a )?calcada (esta|ta) (ruim|quebrada|horrivel|impossivel)\b/ },
  // Sair da conversa falando, sem procurar o botão. Casa a frase inteira de
  // propósito: "obrigado, e o que tem à direita?" é pergunta, não despedida.
  {
    acao: Acao.ENCERRAR,
    re: /^(ja (deu|chega|basta|entendi)|chega|basta|pode parar|para( de falar)?|parar|encerra(r)?( a conversa)?|fecha(r)?( a conversa)?|sai(r)?( da conversa)?|tchau|ate (logo|mais)|valeu|obrigad[oa]( viu| iris)?|brigad[oa]|e so isso|so isso|nada mais|silencio|fica quieto|cala a boca)$/,
  },
];

// "me leva até a farmácia", "quero ir para a rua 13 de junho", "como chego na rodoviária"
const IR = /^(?:me )?(?:leva|leve|levar|guia|guie|guiar)(?: me)? (?:ate|para|pra|pro|no|na|a|ao)? ?(.+)$|^(?:quero|preciso|vou) (?:ir|chegar) (?:ate|para|pra|pro|no|na|a|ao) (.+)$|^como (?:eu )?(?:chego|vou) (?:ate|para|pra|pro|no|na|a|ao) (.+)$|^(?:ir|navegar) (?:ate|para|pra|pro) (.+)$/;

/**
 * Texto reconhecido -> { acao, destino?, texto }.
 * O destino volta com a grafia original (com acento), que é a que o
 * geocodificador entende melhor.
 */
export function interpretarComando(falado) {
  const original = String(falado ?? "").trim();
  const t = normalizarFala(original);
  if (!t) return null;

  for (const r of REGRAS) {
    if (!r.re.test(t)) continue;
    // `dificuldade` só existe nas regras de barreira; nas outras sai undefined
    // e quem chama ignora.
    return { acao: r.acao, dificuldade: r.dificuldade, texto: original };
  }

  const m = t.match(IR);
  if (m) {
    const alvoNorm = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").replace(/^(a|o|as|os) /, "").trim();
    if (alvoNorm) return { acao: Acao.IR, destino: recuperarGrafia(original, alvoNorm), texto: original };
  }
  return { acao: Acao.PERGUNTA, texto: original };
}

/** Acha no texto original o trecho que corresponde ao destino normalizado. */
function recuperarGrafia(original, alvoNorm) {
  const palavras = original.split(/\s+/);
  const n = alvoNorm.split(" ").length;
  for (let i = 0; i + n <= palavras.length; i++) {
    const trecho = palavras.slice(i, i + n).join(" ");
    if (normalizarFala(trecho) === alvoNorm) return trecho.replace(/[?.!,;]+$/, "");
  }
  return alvoNorm;
}

export const AJUDA_FALADA =
  "Você pode dizer: onde estou; o que tem na minha frente; leia isso; me leva até a farmácia; "
  + "parar rota; repete; ou socorro. Com a descrição detalhada ligada, pode perguntar qualquer "
  + "coisa sobre o que a câmera mostra, como: essa nota é de quanto, ou tem cadeira livre. "
  + "Se a calçada atrapalhar, me conte: diga anota essa barreira, ou simplesmente o que "
  + "aconteceu — tive que descer para a rua, tropecei, não consegui passar. Eu guardo o "
  + "local e o que você disse, e isso vira denúncia. "
  + "Pode continuar falando que eu continuo ouvindo. Para encerrar, diga: pode parar.";

// ============================================================
// Histórico da conversa
// ============================================================

export const MAX_TURNOS = 6;
export const VALIDADE_CONVERSA_MS = 3 * 60 * 1000;

/**
 * Guarda as últimas perguntas e respostas, só em texto, para a pergunta
 * seguinte ter contexto ("e a da esquerda?"). Depois de três minutos parada,
 * a conversa recomeça: o lugar provavelmente mudou, e falar da cena antiga
 * como se fosse a atual é pior do que perguntar de novo.
 */
export class Conversa {
  constructor({ maxTurnos = MAX_TURNOS, validadeMs = VALIDADE_CONVERSA_MS } = {}) {
    this.maxTurnos = maxTurnos;
    this.validadeMs = validadeMs;
    this.turnos = [];        // [{ pergunta, resposta, ts }]
    this.ultimaFala = null;  // para "repete"
  }

  historico(agoraMs) {
    if (this.turnos.length && agoraMs - this.turnos[this.turnos.length - 1].ts > this.validadeMs) {
      this.turnos = [];
    }
    return this.turnos.map(({ pergunta, resposta }) => ({ pergunta, resposta }));
  }

  registrar(pergunta, resposta, agoraMs) {
    this.turnos.push({ pergunta: String(pergunta).slice(0, 500), resposta: String(resposta).slice(0, 1500), ts: agoraMs });
    if (this.turnos.length > this.maxTurnos) this.turnos.shift();
    this.ultimaFala = resposta;
  }

  limpar() { this.turnos = []; }
}
