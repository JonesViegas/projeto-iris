// Descrição rica da cena, por modelo de visão-linguagem. OPCIONAL e DESLIGADA.
//
// Tudo o mais no Íris roda dentro do aparelho e nenhuma imagem sai dele. Este
// módulo é a única exceção, e por isso tem regra própria:
//
//   1. Nasce desligado. Só liga por escolha explícita nos ajustes.
//   2. Ao ligar, o app FALA o que vai acontecer — quem não enxerga não lê
//      letra miúda de termo de uso, e consentimento que a pessoa não ouviu
//      não é consentimento.
//   3. Envia um quadro por vez, só quando o usuário aperta o botão. Nunca o
//      vídeo, nunca em laço, nunca em segundo plano.
//   4. A chave da API NÃO mora aqui. O app conversa com um proxy do próprio
//      projeto (`servidor/proxy-descricao.mjs`), que guarda a chave no
//      servidor. Chave de API dentro de um PWA é chave pública: qualquer
//      pessoa abre o código-fonte e lê.
//
// O que isto acrescenta ao que já existe: o detector local diz "pessoa à
// frente, a três metros". O modelo de visão diz "uma mulher com uma criança
// no colo espera na fila do caixa; a fila dobra à esquerda e o balcão de
// atendimento fica no fundo, à direita". Para se situar num lugar novo, a
// segunda frase é de outra natureza.

const QUALIDADE = 0.82;
const LARGURA_MAX = 1024;    // acima disso o custo sobe e a descrição não melhora
const TIMEOUT_MS = 20000;

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");

/** O texto que a pessoa OUVE antes de ligar a opção. Nada de letra miúda. */
export const AVISO_DE_CONSENTIMENTO =
  "Atenção. Ao ligar a descrição detalhada, uma foto da câmera será enviada pela "
  + "internet a um servidor de inteligência artificial toda vez que você tocar em "
  + "'O que tem aqui?'. Isso gasta dados do seu plano e a foto sai do aparelho. "
  + "Todo o resto do aplicativo continua funcionando só aqui dentro. "
  + "Toque de novo para confirmar, ou ignore para manter desligado.";

export class DescritorNaNuvem {
  /**
   * endpoint: a URL do SEU proxy. Sem ele, o módulo se recusa a funcionar —
   * não há modo "cole sua chave aqui", de propósito.
   */
  constructor({ endpoint = "", idioma = "pt-BR" } = {}) {
    this.endpoint = endpoint;
    this.idioma = idioma;
    this.ocupado = false;
    this.ultimoMs = 0;
  }

  get configurado() { return Boolean(this.endpoint); }

  /** Captura um quadro e devolve o JPEG em base64, sem o prefixo data:. */
  #quadro(video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const escala = Math.min(1, LARGURA_MAX / vw);
    canvas.width = Math.round(vw * escala);
    canvas.height = Math.round(vh * escala);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", QUALIDADE).split(",")[1];
  }

  /**
   * Descreve a cena. `contexto` é o que o app já sabe pelo processamento local
   * (objetos, distâncias, tipo de piso) — mandar isso junto evita que o modelo
   * contradiga o detector e dá a ele a escala métrica, que ele não tem.
   *
   * Devolve { texto, ms } ou lança erro com mensagem já falável.
   */
  async descrever(video, contexto = {}) {
    if (!this.configurado) throw new Error("A descrição detalhada não está configurada neste servidor.");
    if (this.ocupado) throw new Error("Ainda estou processando a descrição anterior.");

    const imagem = this.#quadro(video);
    if (!imagem) throw new Error("A câmera não entregou imagem.");

    this.ocupado = true;
    const t0 = performance.now();
    const corte = AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;

    try {
      const r = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagem, contexto, idioma: this.idioma }),
        signal: corte,
      });

      if (r.status === 429) throw new Error("O serviço de descrição está ocupado. Tente em instantes.");
      if (!r.ok) throw new Error("O serviço de descrição não respondeu.");

      // Quando o proxy não está instalado, o nginx devolve a própria página do
      // app com status 200. Sem esta checagem, o erro que chega ao usuário é
      // um "JSON inválido" que não ajuda ninguém a entender o que fazer.
      const tipo = r.headers.get("content-type") ?? "";
      if (!tipo.includes("application/json")) {
        throw new Error("A descrição detalhada não está instalada neste servidor. "
          + "Sigo com o que o aparelho enxerga sozinho.");
      }

      const j = await r.json().catch(() => null);
      if (!j?.texto) throw new Error("A descrição voltou vazia.");

      this.ultimoMs = Math.round(performance.now() - t0);
      return { texto: String(j.texto).trim(), ms: this.ultimoMs };
    } catch (e) {
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw new Error("A descrição demorou demais. Sigo com o que vejo aqui.");
      }
      if (e instanceof TypeError) throw new Error("Sem internet para a descrição detalhada.");
      throw e;
    } finally {
      this.ocupado = false;
    }
  }
}

/**
 * Resumo do que o processamento local já apurou, para viajar junto com a foto.
 * Mantemos curto: é contexto, não transcrição.
 */
export function contextoLocal({ objetos = [], piso = null, navegando = null, local = null }) {
  return {
    objetos: objetos.slice(0, 8).map((o) => ({
      classe: o.detection?.label ?? o.label,
      direcao: o.direction,
      metros: o.distanceM != null ? Number(o.distanceM.toFixed(1)) : null,
      vindo: o.approaching === true,
    })),
    piso,
    navegando,
    // "Onde estou?": rua e referências do mapa, já em texto. Só coordenada
    // virada palavra — a posição exata não viaja.
    local: local ? String(local).slice(0, 600) : null,
  };
}
