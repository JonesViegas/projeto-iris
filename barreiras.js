// Barreiras de calçada: do que o app vê ao que o Ministério Público lê.
//
// POR QUE ISTO EXISTE. O Íris já percebe buraco, bueiro aberto, degrau, tapume
// e calçada quebrada — e, até aqui, essa percepção morria na sessão. A pessoa
// cega desviava do buraco, chegava em casa, e o buraco continuava lá para a
// próxima pessoa. O app era um instrumento individual num problema coletivo.
//
// O que muda aqui: cada barreira encontrada vira um REGISTRO com local, tipo,
// data e — e esta é a parte que nenhum sensor dá — A DIFICULDADE QUE A PESSOA
// TEVE. Não "havia um tapume na calçada", mas "havia um tapume na calçada e eu
// precisei descer para a rua". A diferença entre as duas frases é a diferença
// entre um dado e uma denúncia.
//
// A CATEGORIZAÇÃO NÃO É NOSSA, e é de propósito. São os seis tipos de barreira
// consolidados na literatura de acessibilidade urbana e usados no projeto
// Caminhar (Unifor / MPCE / LINO), que organiza reclamações de calçada para
// fiscalização. Usar a mesma taxonomia é o que permite ao registro do Íris
// entrar num painel que já existe, em vez de criar mais uma ilha de dados.
//
// O QUE ESTE MÓDULO NÃO FAZ, e não pode fazer:
//   - não envia nada para a rede. Ele monta o pacote; mandar é decisão de um
//     adaptador, com consentimento explícito (ver integracao.js);
//   - não guarda imagem por conta própria. A foto é opcional, entra só com
//     consentimento por ocorrência, e o registro funciona inteiro sem ela;
//   - não identifica a pessoa. O registro tem local e hora, nunca quem.
//
// Sem dependência de navegador: `node --test test/barreiras.test.mjs`.

// ============================================================
// Os seis tipos
// ============================================================

export const TipoBarreira = {
  PASSEIO_AUSENTE: "passeio_ausente",
  INFRA_DEGRADADA: "infraestrutura_degradada",
  PAVIMENTO_IRREGULAR: "pavimentacao_inadequada",
  PISO_TATIL: "piso_tatil_inadequado",
  OCUPACAO_IRREGULAR: "ocupacao_irregular",
  SEM_SINAL_SONORO: "falta_sinalizacao_sonora",
};

/**
 * O que cada tipo é, quem costuma responder por ele, e a referência normativa.
 *
 * `gravidade` é de 1 a 3 e responde a uma pergunta só: o que acontece com uma
 * pessoa cega que não for avisada? 3 é queda; 2 é ter de sair da calçada; 1 é
 * perder a referência. Não é a dificuldade de consertar nem o custo da obra.
 */
export const BARREIRAS = {
  [TipoBarreira.PASSEIO_AUSENTE]: {
    rotulo: "Passeio ausente",
    descricao: "Trecho sem calçada, obrigando o pedestre a andar na pista.",
    norma: "NBR 9050, item 6.10; Lei 13.146/2015, art. 3º",
    responsavel: "Município (prefeitura) e proprietário lindeiro",
    gravidade: 3,
  },
  [TipoBarreira.INFRA_DEGRADADA]: {
    rotulo: "Infraestrutura degradada",
    descricao: "Calçada quebrada, buraco, bueiro sem tampa, piso solto ou levantado por raiz.",
    norma: "NBR 9050, item 6.1.1; Código de Posturas municipal",
    responsavel: "Proprietário do imóvel lindeiro; concessionária, no caso de bueiro",
    gravidade: 3,
  },
  [TipoBarreira.PAVIMENTO_IRREGULAR]: {
    rotulo: "Pavimentação inadequada às normas técnicas",
    descricao: "Piso escorregadio, desnível acima do permitido, inclinação excessiva, degrau isolado.",
    norma: "NBR 9050, itens 6.1.1 e 6.9",
    responsavel: "Proprietário do imóvel lindeiro; município na fiscalização",
    gravidade: 2,
  },
  [TipoBarreira.PISO_TATIL]: {
    rotulo: "Piso tátil inadequado ou ausente",
    descricao: "Falta de piso tátil de alerta ou direcional, ou piso instalado fora da norma.",
    norma: "NBR 9050, item 6.9; NBR 16537",
    responsavel: "Município; órgão gestor do equipamento público",
    gravidade: 2,
  },
  [TipoBarreira.OCUPACAO_IRREGULAR]: {
    rotulo: "Ocupação irregular",
    descricao: "Tapume de obra, mesa, veículo, entulho ou mercadoria ocupando a faixa livre.",
    norma: "NBR 9050, item 6.1.2 (faixa livre mínima de 1,20 m); Código de Posturas",
    responsavel: "Ocupante; município na fiscalização",
    gravidade: 2,
  },
  [TipoBarreira.SEM_SINAL_SONORO]: {
    rotulo: "Falta de suporte tecnológico, como sinalização sonora",
    descricao: "Travessia semaforizada sem sinal sonoro para pessoas com deficiência visual.",
    norma: "NBR 9050, item 6.12.2; CTB, art. 80 §2º",
    responsavel: "Órgão de trânsito municipal",
    gravidade: 3,
  },
};

/**
 * De classe detectada para tipo de barreira.
 *
 * As chaves cobrem o vocabulário aberto (`aberto.js`), as classes do detector
 * próprio (`treino/classes.yaml`) e os rótulos do ADE20K que a segmentação
 * usa. Classe desconhecida devolve null, e registro sem tipo não vira
 * denúncia — preferimos perder um caso a enviar ao MP uma acusação que o app
 * não sabe sustentar.
 */
const DE_CLASSE = {
  // infraestrutura degradada
  buraco: TipoBarreira.INFRA_DEGRADADA,
  "bueiro aberto": TipoBarreira.INFRA_DEGRADADA,
  bueiro_aberto: TipoBarreira.INFRA_DEGRADADA,
  "calçada quebrada": TipoBarreira.INFRA_DEGRADADA,
  calcada_quebrada: TipoBarreira.INFRA_DEGRADADA,
  "piso solto": TipoBarreira.INFRA_DEGRADADA,
  "raiz levantando o piso": TipoBarreira.INFRA_DEGRADADA,

  // pavimentação inadequada
  degrau: TipoBarreira.PAVIMENTO_IRREGULAR,
  "degrau isolado": TipoBarreira.PAVIMENTO_IRREGULAR,
  desnivel: TipoBarreira.PAVIMENTO_IRREGULAR,
  "rampa íngreme": TipoBarreira.PAVIMENTO_IRREGULAR,
  step: TipoBarreira.PAVIMENTO_IRREGULAR,
  stairs: TipoBarreira.PAVIMENTO_IRREGULAR,

  // passeio ausente
  "sem calçada": TipoBarreira.PASSEIO_AUSENTE,
  passeio_ausente: TipoBarreira.PASSEIO_AUSENTE,

  // piso tátil
  "piso tátil": TipoBarreira.PISO_TATIL,
  piso_tatil: TipoBarreira.PISO_TATIL,
  "piso tátil interrompido": TipoBarreira.PISO_TATIL,

  // ocupação irregular
  "tapume de obra": TipoBarreira.OCUPACAO_IRREGULAR,
  tapume_obra: TipoBarreira.OCUPACAO_IRREGULAR,
  entulho: TipoBarreira.OCUPACAO_IRREGULAR,
  "mesa na calçada": TipoBarreira.OCUPACAO_IRREGULAR,
  "carro na calçada": TipoBarreira.OCUPACAO_IRREGULAR,
  "moto na calçada": TipoBarreira.OCUPACAO_IRREGULAR,
  andaime: TipoBarreira.OCUPACAO_IRREGULAR,
  "placa no meio da calçada": TipoBarreira.OCUPACAO_IRREGULAR,

  // sinalização sonora
  "semáforo sem som": TipoBarreira.SEM_SINAL_SONORO,
  semaforo_sem_som: TipoBarreira.SEM_SINAL_SONORO,
};

/** Classe detectada -> tipo de barreira, ou null quando não sabemos. */
export function classificar(classe) {
  if (!classe) return null;
  const k = String(classe).trim().toLowerCase();
  return DE_CLASSE[k] ?? null;
}

// ============================================================
// A dificuldade: o que só a pessoa sabe
// ============================================================
// Isto é o dado que nenhum sensor produz, e é o que transforma uma detecção em
// prova. Um buraco fotografado é um buraco. Um buraco que fez alguém descer
// para a rua entre carros é uma violação de direito, com consequência narrável.
//
// A ordem importa: é a ordem de gravidade usada no cálculo de prioridade.

export const Dificuldade = {
  PERCEBI: "percebi",             // o app avisou e eu desviei sem esforço
  DESVIEI: "desviei",             // precisei mudar de trajetória
  FUI_PARA_RUA: "fui_para_rua",   // tive de descer da calçada para a pista
  PEDI_AJUDA: "pedi_ajuda",       // precisei de outra pessoa para passar
  NAO_PASSEI: "nao_passei",       // tive de voltar: o caminho ficou impossível
  TROPECEI: "tropecei",           // bati ou tropecei
  CAI: "cai",                     // caí
};

/** Peso de cada dificuldade na prioridade. Cair pesa muito mais que desviar. */
const PESO_DIFICULDADE = {
  [Dificuldade.PERCEBI]: 0,
  [Dificuldade.DESVIEI]: 1,
  [Dificuldade.FUI_PARA_RUA]: 4,
  [Dificuldade.PEDI_AJUDA]: 3,
  [Dificuldade.NAO_PASSEI]: 4,
  [Dificuldade.TROPECEI]: 5,
  [Dificuldade.CAI]: 8,
};

export const DIFICULDADE_FALADA = {
  [Dificuldade.PERCEBI]: "percebi a tempo e desviei",
  [Dificuldade.DESVIEI]: "precisei mudar de caminho",
  [Dificuldade.FUI_PARA_RUA]: "precisei descer para a rua",
  [Dificuldade.PEDI_AJUDA]: "precisei pedir ajuda",
  [Dificuldade.NAO_PASSEI]: "não consegui passar e tive de voltar",
  [Dificuldade.TROPECEI]: "tropecei",
  [Dificuldade.CAI]: "caí",
};

// ============================================================
// Agrupamento por local
// ============================================================
// Cinco pessoas tropeçando no mesmo buraco não são cinco buracos. O painel do
// Caminhar mostra "Denúncias no mesmo local: 5" porque é a RECORRÊNCIA que
// move a fiscalização — um caso isolado é azar, cinco no mesmo ponto é uma
// calçada abandonada.
//
// O agrupamento é por grade de ~20 m. Mais fino do que isso brigaria com o
// erro do GPS urbano, que é de 5 a 20 m: dois registros do mesmo buraco
// cairiam em células diferentes e a recorrência sumiria justamente no caso que
// ela existe para revelar.

export const RAIO_M = 20;
const M_POR_GRAU_LAT = 111_320;

/**
 * Distância em metros entre dois pontos próximos.
 *
 * Aproximação equirretangular: a menos de um quilômetro o erro é desprezível
 * perto do erro do próprio GPS, e é muito mais barata que a fórmula completa.
 */
export function distanciaM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity;
  const latMedia = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dy = (a.lat - b.lat) * M_POR_GRAU_LAT;
  const dx = (a.lng - b.lng) * M_POR_GRAU_LAT * Math.cos(latMedia);
  return Math.hypot(dx, dy);
}

// POR QUE NÃO UMA GRADE DE CÉLULAS, que é o jeito óbvio de agrupar:
//
// A primeira versão deste módulo arredondava a coordenada para uma grade de
// 20 m e usava a célula como chave. Parece bastar, e não basta — nenhuma grade
// fixa basta. Dois registros a dois metros um do outro caem em células
// diferentes sempre que calham de estar nos dois lados de uma fronteira, e
// fronteira existe a cada 20 metros. Medido no teste: cinco registros do mesmo
// buraco, dentro de nove metros, viraram três "buracos" diferentes.
//
// E isso quebra justamente o que o agrupamento existe para produzir. A
// recorrência — "cinco denúncias neste mesmo ponto" — é o que move a
// fiscalização; um buraco que aparece três vezes como três buracos distintos
// não move nada.
//
// O agrupamento por DISTÂNCIA não tem fronteira: a ocorrência entra no caso
// mais próximo que esteja dentro do raio, e o centro do caso acompanha as
// leituras. É o que o erro do GPS urbano (5 a 20 m) exige.

// ============================================================
// O registro
// ============================================================

/**
 * Guarda as barreiras da pessoa, agrupadas por local, e monta a denúncia.
 *
 * Puro de propósito: nada de localStorage, nada de rede, nada de Date.now()
 * escondido. Quem chama passa o relógio e decide onde guardar. É o que permite
 * testar uma semana de uso em milissegundos.
 */
export class RegistroDeBarreiras {
  constructor({ raioM = RAIO_M, maxOcorrencias = 2000 } = {}) {
    this.raioM = raioM;
    this.maxOcorrencias = maxOcorrencias;
    this.ocorrencias = [];
    // Centros dos casos: [{ id, tipo, lat, lng, n }]. O centro é a média das
    // leituras, que é o melhor estimador do ponto real quando cada leitura
    // carrega o erro do GPS.
    this.locais = [];
  }

  /**
   * A que caso esta ocorrência pertence? Ao mais próximo do mesmo tipo dentro
   * do raio; se não houver, a um caso novo.
   */
  #localDe(tipo, lat, lng) {
    if (lat == null || lng == null) return `sem-gps:${tipo}`;
    let melhor = null, menor = Infinity;
    for (const l of this.locais) {
      if (l.tipo !== tipo) continue;
      const d = distanciaM({ lat, lng }, l);
      if (d <= this.raioM && d < menor) { menor = d; melhor = l; }
    }
    if (melhor) {
      // Média corrente: o centro melhora a cada leitura em vez de ficar preso
      // à primeira, que pode ter sido a de pior sinal.
      melhor.lat += (lat - melhor.lat) / (melhor.n + 1);
      melhor.lng += (lng - melhor.lng) / (melhor.n + 1);
      melhor.n++;
      return melhor.id;
    }
    const novo = { id: `l${this.locais.length + 1}:${tipo}`, tipo, lat, lng, n: 1 };
    this.locais.push(novo);
    return novo.id;
  }

  /**
   * Anota uma barreira.
   *
   * @param classe      o que o detector achou ("buraco", "tapume de obra"…)
   * @param tipo        força o tipo, quando a pessoa escolhe pela voz
   * @param posicao     { lat, lng, precisaoM }
   * @param endereco    texto do Nominatim, quando houver
   * @param dificuldade um valor de Dificuldade — o dado que vale mais
   * @param confianca   0..1 do detector
   * @param evidencia   { id } de uma foto guardada à parte, com consentimento
   * @param nota        o que a pessoa ditou
   * @param quando      ISO 8601
   * @returns a ocorrência gravada, ou null se não há tipo que a sustente
   */
  anotar({
    classe = null, tipo = null, posicao = null, endereco = null,
    dificuldade = null, confianca = null, evidencia = null, nota = null,
    quando = null, origem = "iris-pwa",
  } = {}) {
    const t = tipo ?? classificar(classe);
    // Sem tipo não há denúncia: preferimos perder o caso a mandar ao Ministério
    // Público uma acusação que o app não sabe sustentar.
    if (!t || !BARREIRAS[t]) return null;

    const o = {
      id: `b-${this.ocorrencias.length}-${String(quando ?? "").slice(11, 19)}`,
      tipo: t,
      classe: classe ?? null,
      confianca: confianca == null ? null : Math.round(confianca * 100) / 100,
      lat: posicao?.lat ?? null,
      lng: posicao?.lng ?? null,
      precisaoM: posicao?.precisaoM ?? null,
      local: this.#localDe(t, posicao?.lat ?? null, posicao?.lng ?? null),
      endereco: endereco ?? null,
      dificuldade,
      nota: nota ?? null,
      evidencia: evidencia?.id ?? null,
      quando: quando ?? null,
      origem,
    };
    this.ocorrencias.push(o);
    if (this.ocorrencias.length > this.maxOcorrencias) this.ocorrencias.shift();
    return o;
  }

  /**
   * Agrupa por local e tipo. Cada grupo é um caso: um ponto da cidade com uma
   * barreira, com quantas vezes ela atrapalhou alguém.
   */
  porLocal() {
    const grupos = new Map();
    for (const o of this.ocorrencias) {
      const k = o.local ?? `sem-gps:${o.tipo}`;
      let g = grupos.get(k);
      if (!g) {
        g = {
          chave: k, tipo: o.tipo, local: o.local,
          endereco: o.endereco, lat: o.lat, lng: o.lng,
          ocorrencias: 0, dificuldades: [], primeira: o.quando, ultima: o.quando,
          evidencias: [], notas: [],
        };
        grupos.set(k, g);
      }
      g.ocorrencias++;
      // O endereço mais informativo vence: o GPS às vezes responde só a cidade.
      if (o.endereco && (!g.endereco || o.endereco.length > g.endereco.length)) g.endereco = o.endereco;
      if (o.lat != null && g.lat == null) { g.lat = o.lat; g.lng = o.lng; }
      if (o.dificuldade) g.dificuldades.push(o.dificuldade);
      if (o.evidencia) g.evidencias.push(o.evidencia);
      if (o.nota) g.notas.push(o.nota);
      if (o.quando) {
        if (!g.primeira || o.quando < g.primeira) g.primeira = o.quando;
        if (!g.ultima || o.quando > g.ultima) g.ultima = o.quando;
      }
    }
    for (const g of grupos.values()) g.prioridade = prioridade(g);
    return [...grupos.values()].sort((a, b) => b.prioridade - a.prioridade);
  }

  /** O relatório inteiro, pronto para virar texto ou JSON. */
  relatorio({ de = null, ate = null } = {}) {
    const dentro = (o) => (!de || (o.quando ?? "") >= de) && (!ate || (o.quando ?? "") <= ate);
    // O recorte reaproveita os casos já formados: reagrupar o subconjunto
    // daria centros diferentes e o mesmo buraco mudaria de identidade entre o
    // relatório da semana e o do mês.
    const recorte = new RegistroDeBarreiras({ raioM: this.raioM });
    recorte.locais = this.locais;
    recorte.ocorrencias = this.ocorrencias.filter(dentro);
    const locais = recorte.porLocal();
    const porTipo = {};
    for (const l of locais) porTipo[l.tipo] = (porTipo[l.tipo] ?? 0) + l.ocorrencias;
    return {
      gerado: null,                       // quem chama carimba a data
      periodo: { de, ate },
      totalOcorrencias: recorte.ocorrencias.length,
      totalLocais: locais.length,
      porTipo,
      comEvidencia: recorte.ocorrencias.filter((o) => o.evidencia).length,
      locais,
    };
  }

  serializar() {
    return { versao: 2, raioM: this.raioM, locais: this.locais, ocorrencias: this.ocorrencias };
  }

  static carregar(dados) {
    const r = new RegistroDeBarreiras({ raioM: dados?.raioM ?? RAIO_M });
    r.ocorrencias = Array.isArray(dados?.ocorrencias) ? dados.ocorrencias : [];
    r.locais = Array.isArray(dados?.locais) ? dados.locais : [];
    return r;
  }

  limpar() { this.ocorrencias = []; this.locais = []; }
}

/**
 * A prioridade de um caso.
 *
 * gravidade do tipo × recorrência, somada ao que de fato aconteceu com as
 * pessoas. Uma barreira grave num ponto por onde ninguém passa fica abaixo de
 * uma barreira média que já derrubou alguém — e é assim que tem de ser: a
 * fiscalização é um recurso escasso e quem decide a ordem é o dano.
 */
export function prioridade(grupo) {
  const g = BARREIRAS[grupo.tipo]?.gravidade ?? 1;
  const dano = (grupo.dificuldades ?? []).reduce((s, d) => s + (PESO_DIFICULDADE[d] ?? 0), 0);
  // A recorrência conta, mas com raiz: o décimo registro no mesmo buraco não
  // vale dez vezes o primeiro.
  const recorrencia = Math.sqrt(Math.max(1, grupo.ocorrencias));
  return Math.round((g * recorrencia * 2 + dano) * 10) / 10;
}

// ============================================================
// A denúncia
// ============================================================

const dataBr = (iso) => {
  if (!iso) return "data não registrada";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "data não registrada";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
};

/**
 * O texto de uma denúncia, de um caso.
 *
 * Escrito para ser lido por quem vai agir: promotor, ouvidoria, secretaria de
 * obras. Por isso cita a norma, nomeia o provável responsável e — o que
 * distingue este registro de um relatório de sensor — conta o que aconteceu
 * com as pessoas.
 *
 * O texto diz sempre que a localização é aproximada e que a classificação é
 * automática. Omitir isso seria dar ao documento uma precisão que ele não tem,
 * e a primeira contestação derrubaria o conjunto inteiro.
 */
export function textoDeDenuncia(grupo, { assinatura = null } = {}) {
  if (!grupo || !BARREIRAS[grupo.tipo]) return null;
  const b = BARREIRAS[grupo.tipo];
  const l = [];

  l.push(`BARREIRA DE ACESSIBILIDADE EM CALÇADA`);
  l.push("");
  l.push(`Tipo: ${b.rotulo}`);
  l.push(`Descrição do tipo: ${b.descricao}`);
  l.push(`Local: ${grupo.endereco ?? "endereço não identificado"}`);
  if (grupo.lat != null) {
    l.push(`Coordenadas aproximadas: ${grupo.lat.toFixed(5)}, ${grupo.lng.toFixed(5)}`);
  }
  l.push(`Ocorrências registradas neste ponto: ${grupo.ocorrencias}`);
  l.push(`Primeiro registro: ${dataBr(grupo.primeira)} · Último: ${dataBr(grupo.ultima)}`);
  l.push("");

  const dif = (grupo.dificuldades ?? []).filter(Boolean);
  if (dif.length) {
    l.push("EFEITO SOBRE O PEDESTRE COM DEFICIÊNCIA VISUAL");
    const contagem = new Map();
    for (const d of dif) contagem.set(d, (contagem.get(d) ?? 0) + 1);
    for (const [d, n] of [...contagem].sort((a, b) => b[1] - a[1])) {
      l.push(`  · ${DIFICULDADE_FALADA[d] ?? d}: ${n} ${n === 1 ? "vez" : "vezes"}`);
    }
    l.push("");
  }

  if (grupo.notas?.length) {
    l.push("RELATO DE QUEM PASSOU");
    for (const n of grupo.notas.slice(0, 5)) l.push(`  “${n}”`);
    l.push("");
  }

  l.push("REFERÊNCIA NORMATIVA");
  l.push(`  ${b.norma}`);
  l.push(`Provável responsável: ${b.responsavel}`);
  l.push("");

  l.push("EVIDÊNCIAS");
  l.push(grupo.evidencias?.length
    ? `  ${grupo.evidencias.length} imagem(ns) anexada(s), com consentimento do registrante.`
    : "  Nenhuma imagem anexada.");
  l.push("");

  // As ressalvas não são rodapé: são o que mantém o documento de pé.
  l.push("COMO ESTE REGISTRO FOI PRODUZIDO");
  l.push("  Registro gerado pelo aplicativo Projeto Íris, assistente de percepção");
  l.push("  para pessoas com deficiência visual. A classificação do tipo de barreira");
  l.push("  é automática e pode conter erro; a localização vem de GPS de telefone");
  l.push("  celular, com erro típico de 5 a 20 metros em área urbana. O relato de");
  l.push("  dificuldade é informado pela própria pessoa que passou pelo local.");
  l.push("  Recomenda-se verificação em campo antes de qualquer medida.");
  if (assinatura) { l.push(""); l.push(assinatura); }
  return l.join("\n");
}

/**
 * O pacote completo para enviar a um painel como o do Caminhar.
 * Sem imagem embutida: a foto, quando existe, vai à parte e por escolha.
 */
export function pacoteDeDenuncia(registro, { gerado, assinatura = null, periodo = {} } = {}) {
  const r = registro.relatorio(periodo);
  return {
    formato: "iris.barreiras.v1",
    gerado,
    resumo: {
      ocorrencias: r.totalOcorrencias,
      locais: r.totalLocais,
      porTipo: r.porTipo,
      comEvidencia: r.comEvidencia,
    },
    casos: r.locais.map((g) => ({
      tipo: g.tipo,
      rotulo: BARREIRAS[g.tipo].rotulo,
      norma: BARREIRAS[g.tipo].norma,
      responsavel: BARREIRAS[g.tipo].responsavel,
      endereco: g.endereco,
      lat: g.lat, lng: g.lng,
      ocorrencias: g.ocorrencias,
      prioridade: g.prioridade,
      dificuldades: g.dificuldades,
      primeira: g.primeira, ultima: g.ultima,
      evidencias: g.evidencias,
      texto: textoDeDenuncia(g, { assinatura }),
    })),
  };
}

// ============================================================
// Material de treino
// ============================================================
// As imagens que a pessoa consentiu em guardar são o dataset que o detector
// próprio precisa — e são melhores do que qualquer coleta encomendada, por um
// motivo só: foram tiradas na altura, no ângulo e na luz de quem usa o app, e
// não na altura de quem tem a câmera no olho.
//
// O manifesto abaixo é o que o pipeline de `treino/` consome. Ele carrega o
// rótulo, o tipo de barreira e o LOCAL — este último porque a divisão do
// dataset tem de ser POR LOCAL (ver treino/classes.yaml). Trinta fotos do
// mesmo buraco espalhadas entre treino e validação dão mAP alto e modelo
// inútil.

export function manifestoDeTreino(registro) {
  const itens = registro.ocorrencias
    .filter((o) => o.evidencia)
    .map((o) => ({
      evidencia: o.evidencia,
      classe: o.classe ?? null,
      tipo: o.tipo,
      // O caso é o agrupamento de divisão: tudo do mesmo ponto vai junto para
      // treino OU para validação, nunca para os dois.
      local: o.local ?? "sem-gps",
      confianca: o.confianca,
      quando: o.quando,
      // Registro que a pessoa marcou como dificuldade real é negativo difícil
      // de ouro: o detector precisa aprender a achar exatamente estes.
      dificuldade: o.dificuldade,
    }));
  const porClasse = {};
  for (const i of itens) porClasse[i.classe ?? "sem-classe"] = (porClasse[i.classe ?? "sem-classe"] ?? 0) + 1;
  return {
    formato: "iris.treino.v1",
    total: itens.length,
    locais: new Set(itens.map((i) => i.local)).size,
    porClasse,
    itens,
  };
}
