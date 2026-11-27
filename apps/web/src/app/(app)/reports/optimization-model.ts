export type OptimizationMetrics = {
  currency: string | null;
  spendCents: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  videoViews: number;
  landingPageViews: number;
  metaConversations: number;
  conversations: number;
  qualifiedLeads: number;
  purchases: number;
  firstPurchases: number;
  revenueCents: number;
  firstPurchaseRevenueCents: number;
  repurchaseRevenueCents: number;
};

export type OptimizationNode = {
  id: string;
  name: string;
  level: "campaign" | "adset" | "ad";
  status: string | null;
  metrics: OptimizationMetrics;
  children: OptimizationNode[];
};

export type OptimizationReport = {
  since: string;
  until: string;
  campaigns: OptimizationNode[];
};

export type MetricFormat = "money" | "integer" | "percent" | "decimal" | "ratio";

export type MetricGroupKey = "delivery" | "click" | "page" | "conversation" | "sales";

export type MetricDefinition = {
  key: string;
  label: string;
  group: MetricGroupKey;
  format: MetricFormat;
  help: string;
  value: (metrics: OptimizationMetrics) => number | null;
};

export const METRIC_GROUPS: { key: MetricGroupKey; label: string; help: string }[] = [
  {
    key: "delivery",
    label: "Entrega",
    help: "Quanto o anúncio foi exibido e quanto custou aparecer. Mostra a competição no leilão e o tamanho do público.",
  },
  {
    key: "click",
    label: "Anúncio e clique",
    help: "Se o criativo prende a atenção e convence a pessoa a clicar.",
  },
  {
    key: "page",
    label: "Site e LP",
    help: "Se quem clicou chegou de fato à página. Vale só para anúncios que levam ao site ou à LP.",
  },
  {
    key: "conversation",
    label: "Conversas",
    help: "Se os cliques viram conversas no WhatsApp e se essas conversas têm perfil de cliente.",
  },
  {
    key: "sales",
    label: "Vendas",
    help: "Se as campanhas se pagam: custo de cada venda, ticket, retorno e valor do cliente.",
  },
];

const ratio = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : null);

export const METRICS: MetricDefinition[] = [
  {
    key: "spend",
    label: "Investimento",
    group: "delivery",
    format: "money",
    help: "Valor gasto nos anúncios no período, segundo a Meta.",
    value: (m) => m.spendCents,
  },
  {
    key: "impressions",
    label: "Impressões",
    group: "delivery",
    format: "integer",
    help: "Quantas vezes o anúncio apareceu na tela. A mesma pessoa pode gerar várias impressões.",
    value: (m) => m.impressions,
  },
  {
    key: "cpm",
    label: "CPM",
    group: "delivery",
    format: "money",
    help: "Custo por mil impressões: investimento ÷ impressões × 1.000. CPM alto significa leilão disputado ou público pequeno: menos pessoas alcançadas com o mesmo orçamento. Para baixar: criativos novos e relevantes, público maior ou outra segmentação.",
    value: (m) => (m.impressions > 0 ? (m.spendCents * 1000) / m.impressions : null),
  },
  {
    key: "reach",
    label: "Alcance",
    group: "delivery",
    format: "integer",
    help: "Pessoas diferentes que viram o anúncio, somadas dia a dia. Quem viu em dois dias conta duas vezes, por isso este número é maior que o alcance do período no Gerenciador de Anúncios.",
    value: (m) => m.reach,
  },
  {
    key: "frequency",
    label: "Frequência",
    group: "delivery",
    format: "decimal",
    help: "Média de vezes que cada pessoa viu o anúncio num mesmo dia: impressões ÷ alcance diário. Muito alta indica saturação do público (renove criativos ou amplie o público); muito baixa pode indicar orçamento curto para o público.",
    value: (m) => ratio(m.impressions, m.reach),
  },
  {
    key: "linkClicks",
    label: "Cliques no link",
    group: "click",
    format: "integer",
    help: "Cliques que levam ao destino do anúncio: o site, a LP ou o WhatsApp. Não inclui curtidas, comentários nem cliques para ampliar a imagem.",
    value: (m) => m.linkClicks,
  },
  {
    key: "ctr",
    label: "CTR",
    group: "click",
    format: "percent",
    help: "Taxa de cliques: cliques no link ÷ impressões. Mede a atratividade do criativo e da mensagem. CTR baixo encarece CPC e CPM. Para subir: novos ganchos, títulos claros, chamada para ação no início do vídeo, outros formatos.",
    value: (m) => ratio(m.linkClicks, m.impressions),
  },
  {
    key: "cpc",
    label: "CPC",
    group: "click",
    format: "money",
    help: "Custo por clique no link: investimento ÷ cliques no link. Quanto custa levar uma pessoa ao site, à LP ou ao WhatsApp. Cai quando o CTR sobe.",
    value: (m) => (m.linkClicks > 0 ? m.spendCents / m.linkClicks : null),
  },
  {
    key: "hookRate",
    label: "Hook Rate",
    group: "click",
    format: "percent",
    help: "Taxa de gancho: visualizações de 3 segundos do vídeo ÷ impressões. Mostra se a abertura do vídeo prende a atenção. Só existe para anúncios em vídeo. Para subir: aberturas mais impactantes e feitas para o público.",
    value: (m) => (m.videoViews > 0 ? ratio(m.videoViews, m.impressions) : null),
  },
  {
    key: "landingPageViews",
    label: "Visualizações da página",
    group: "page",
    format: "integer",
    help: "Pessoas que clicaram e esperaram a página carregar até o pixel da Meta registrar a visita. Só existe para anúncios com destino no site ou na LP.",
    value: (m) => m.landingPageViews,
  },
  {
    key: "connectRate",
    label: "Connect Rate",
    group: "page",
    format: "percent",
    help: "Taxa de conexão: visualizações da página ÷ cliques no link. Mostra quantos cliques chegam de fato à página. Baixa indica página lenta, problema no celular ou pixel com falha.",
    value: (m) => (m.landingPageViews > 0 ? ratio(m.landingPageViews, m.linkClicks) : null),
  },
  {
    key: "conversations",
    label: "Conversas",
    group: "conversation",
    format: "integer",
    help: "Leads novos: pessoas cujo primeiro contato no WhatsApp foi atribuído a este anúncio no período, pelo RastrackDash. Quem já tinha conversado antes não conta de novo.",
    value: (m) => m.conversations,
  },
  {
    key: "clickToConversation",
    label: "Clique → conversa",
    group: "conversation",
    format: "percent",
    help: "CPC x Ação: conversas ÷ cliques no link. Muitos cliques e poucas conversas indicam curiosos ou falta de clareza sobre o que acontece depois do clique. Diga no anúncio o próximo passo (\"Fale agora pelo WhatsApp\") e mantenha a promessa do anúncio no destino.",
    value: (m) => ratio(m.conversations, m.linkClicks),
  },
  {
    key: "costPerConversation",
    label: "Custo por conversa",
    group: "conversation",
    format: "money",
    help: "CPA de lead: investimento ÷ conversas (leads novos).",
    value: (m) => (m.conversations > 0 ? m.spendCents / m.conversations : null),
  },
  {
    key: "qualifiedLeads",
    label: "Leads qualificados",
    group: "conversation",
    format: "integer",
    help: "Conversas que chegaram à etapa de lead qualificado configurada nas regras de conversão.",
    value: (m) => m.qualifiedLeads,
  },
  {
    key: "leadQuality",
    label: "Qualidade dos leads",
    group: "conversation",
    format: "percent",
    help: "Leads qualificados ÷ conversas. Indica se o anúncio atrai pessoas com perfil de cliente. Para melhorar: deixe claro no anúncio para quem é o serviço e concentre a verba nos públicos com melhores leads.",
    value: (m) => ratio(m.qualifiedLeads, m.conversations),
  },
  {
    key: "purchases",
    label: "Vendas",
    group: "sales",
    format: "integer",
    help: "Vendas atribuídas a este anúncio no período (primeiras compras e recompras).",
    value: (m) => m.purchases,
  },
  {
    key: "cpa",
    label: "CPA",
    group: "sales",
    format: "money",
    help: "Custo por aquisição: investimento ÷ vendas. Se ficar acima da margem, a campanha dá prejuízo. Para baixar, encontre a etapa fraca do funil (CPM, CTR, conversas, qualidade) e trabalhe nela.",
    value: (m) => (m.purchases > 0 ? m.spendCents / m.purchases : null),
  },
  {
    key: "revenue",
    label: "Receita",
    group: "sales",
    format: "money",
    help: "Receita das vendas atribuídas aos anúncios no período.",
    value: (m) => m.revenueCents,
  },
  {
    key: "averageTicket",
    label: "Ticket médio",
    group: "sales",
    format: "money",
    help: "Valor médio por venda: receita ÷ vendas. Sobe com pacotes, serviços complementares e versões premium.",
    value: (m) => (m.purchases > 0 ? m.revenueCents / m.purchases : null),
  },
  {
    key: "roas",
    label: "ROAS",
    group: "sales",
    format: "ratio",
    help: "Retorno sobre o investimento em anúncios: receita ÷ investimento. 5x significa R$ 5 de receita para cada R$ 1 investido. Precisa cobrir os custos e a margem.",
    value: (m) => ratio(m.revenueCents, m.spendCents),
  },
  {
    key: "ltv",
    label: "LTV",
    group: "sales",
    format: "money",
    help: "Valor do cliente: (receita da primeira compra + receita das recompras) ÷ clientes novos. Mostra quanto cada cliente trazido pelo anúncio gerou até agora, recompras incluídas, e quanto dá para pagar por um cliente novo.",
    value: (m) =>
      m.firstPurchases > 0 ? (m.firstPurchaseRevenueCents + m.repurchaseRevenueCents) / m.firstPurchases : null,
  },
];

/** Metric kept visible when its group is collapsed. */
export const GROUP_KEY_METRIC: Record<MetricGroupKey, string> = {
  delivery: "spend",
  click: "ctr",
  page: "connectRate",
  conversation: "costPerConversation",
  sales: "roas",
};

export const LEVEL_LABEL: Record<OptimizationNode["level"], string> = {
  campaign: "Campanha",
  adset: "Conjunto",
  ad: "Anúncio",
};

export function isOptimizationReport(value: unknown): value is OptimizationReport {
  const report = value as Partial<OptimizationReport> | null;
  return Boolean(report && Array.isArray(report.campaigns));
}

export function visibleMetrics(collapsed: ReadonlySet<MetricGroupKey>): MetricDefinition[] {
  return METRICS.filter((metric) => !collapsed.has(metric.group) || GROUP_KEY_METRIC[metric.group] === metric.key);
}

const SUMMED: (keyof OptimizationMetrics)[] = [
  "spendCents",
  "impressions",
  "reach",
  "linkClicks",
  "videoViews",
  "landingPageViews",
  "metaConversations",
  "conversations",
  "qualifiedLeads",
  "purchases",
  "firstPurchases",
  "revenueCents",
  "firstPurchaseRevenueCents",
  "repurchaseRevenueCents",
];

export function sumMetrics(nodes: OptimizationNode[]): OptimizationMetrics {
  const total = Object.fromEntries(SUMMED.map((key) => [key, 0])) as unknown as OptimizationMetrics;
  total.currency = nodes[0]?.metrics.currency ?? null;
  for (const node of nodes) {
    for (const key of SUMMED) (total[key] as number) += node.metrics[key] as number;
  }
  return total;
}

/** Ids expanded so the tree opens down to the chosen level. */
export function expandedToLevel(campaigns: OptimizationNode[], level: OptimizationNode["level"]): string[] {
  if (level === "campaign") return [];
  const ids: string[] = [];
  for (const campaign of campaigns) {
    ids.push(campaign.id);
    if (level === "ad") ids.push(...campaign.children.map((adSet) => adSet.id));
  }
  return ids;
}

export function formatMetric(value: number | null, format: MetricFormat, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  switch (format) {
    case "money":
      return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: currency ?? "BRL" });
    case "integer":
      return Math.round(value).toLocaleString("pt-BR");
    case "percent": {
      const pct = value * 100;
      return `${pct.toLocaleString("pt-BR", { maximumFractionDigits: pct < 10 ? 2 : 1 })}%`;
    }
    case "decimal":
      return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "ratio":
      return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;
  }
}
