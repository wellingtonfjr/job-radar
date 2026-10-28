import type { CategoryId, EmploymentType, Seniority } from "../domain/job.js";

/**
 * Rule-based classification of title + source hints into the shared
 * taxonomy. Rules are ordered: the first match wins, so more specific rules
 * (e.g. "machine learning engineer" → AI/ML) come before generic ones
 * ("engineer" → Software Development).
 *
 * The job title is the strongest signal and is checked first. Source hints
 * (department, industry, the source's own category) are only consulted when
 * the title is inconclusive, because departments are coarse — a "Product
 * Designer" often sits in an "Engineering" department.
 */

type Rule<T> = [RegExp, T];

const CATEGORY_RULES: Rule<CategoryId>[] = [
  [/\b(machine learning|ml engineer|mlops|ai engineer|ai researcher|artificial intelligence|llm|deep learning|computer vision|nlp|applied scientist|research scientist|ai\/ml|applied ai|generative ai|genai|inteligencia artificial|aprendizado de maquina|cientista de ia|engenheir[oa](?:\(a\))? de (?:ia|machine learning)|ia|ai (?:platform|specialist|transformation)|agentic)\b/i, "ai-ml"],
  [/\b(security|secops|appsec|infosec|penetration|soc analyst|cyber|cybersecurity|seguranca da informacao|ciberseguranca|seguranca cibernetica|pentest|seguranca|red team|identidade)\b/i, "security"],
  [/\b(devops|sre|site reliability|platform engineer|infrastructure|cloud engineer|cloud architect|systems? administrator|sysadmin|network engineer|kubernetes|devsecops|it support|helpdesk|help desk|service desk|it administrator|it engineer|information technology|infraestrutura|redes|suporte de ti|suporte tecnico de ti|analista de suporte de ti|sustentacao|nuvem|administrador de banco de dados|cloud|finops|ti|ansible|servicenow|mensageria)\b/i, "devops"],
  [/\b(qa|quality assurance|test(ing)? engineer|sdet|tester|test automation|qualidade de software|analista de testes?|testes automatizados)\b/i, "qa"],
  [/\b(data scientist|data analyst|data engineer|analytics|business intelligence|bi developer|bi analyst|data architect|database administrator|dba|statistician|data and analytics|data|dados|cientista de dados|bi|analytic|inteligencia de (?:mercado|espaco|negocios)|metadados|geoespaciais|gis)\b/i, "data"],
  [/\b(product manager|product owner|product lead|head of product|vp of product|product management|group product|product operations|technical program manager|program manager|gerente de produto|gestor(?:a)? de produto|analista de produto|produtos?|po|tech product|product flow)\b/i, "product"],
  [/\b(designer|design lead|ux|ui\/ux|user experience|user researcher|ux researcher|illustrator|art director|creative director|motion|brand design|design|estilista|estilo|modelista|edicao de video)\b/i, "design"],
  // Project management, even of software projects.
  [/\b(project manager|gerente de projetos?|scrum master|agile coach|agilista|pmo|projet manager)\b/i, "operations"],
  // Engineer-titled roles that belong to non-engineering functions.
  [/\b(sales engineer|solutions? (engineer|consultant)|pre-?sales)\b/i, "sales"],
  [/\b(support engineer|technical support|customer success engineer)\b/i, "customer-support"],
  [/\b(software|developer|entwickler(in)?|softwareentwickler(\*in)?|engineer(ing)?|programmer|frontend|front-end|front end|backend|back-end|back end|full[- ]?stack|mobile|ios|android|web developer|architect|cto|tech lead|swe|golang|python|java|javascript|typescript|react|ruby|php|\.net|rust|scala|elixir|salesforce developer|blockchain|embedded|firmware|game developer|desenvolvedor(?:a)?|programador(?:a)?|engenheir[oa](?:\(a\))? de software|engenharia de software|analista de sistemas|analista desenvolvedor|arquitet[oa](?:\(a\))?|dev|tecnologia|lider tecnico|tech manager|salesforce|sistemas|desenvolvimento(?!\s+(?:de\s+)?(?:negocios|parcerias|pessoas|jornadas|humano))|sap|erp|dynamics 365|power platform|pl\/sql|analista funcional|requisitos|aplicacoes)\b/i, "software-development"],
  [/\b(customer (support|service|success|experience|care)|support (agent|specialist|engineer|representative)|technical support|client success|call center|customer happiness|cx|support|atendimento|suporte|sucesso do cliente|relacionamento com (?:o )?cliente|sac|experiencia (?:do )?cliente|ouvidoria|implantacao|onboarding|zendesk)\b/i, "customer-support"],
  [/\b(marketing|seo|sem|content marketing|social media|brand|communications|pr manager|public relations|demand gen|community manager|performance marketing|copywriter|redes sociais|midias sociais|trafego pago|trafego|comunicacao|branding|growth (?:lead|manager|marketing|analyst|hacker)|crm|martech|marketplace|inbound|performance)\b/i, "marketing"],
  [/\b(account executive|sales|verkauf|vertrieb|\w*verkaufs\w*|business development|bdr|sdr|account manager|partnerships?|revenue|pre-?sales|solutions? consultant|solutions? engineer|go-to-market|gtm|channel manager|key account|vendas|vendedor(?:a)?|comercial|executiv[oa](?:\(a\))? de (?:contas|vendas)|executiv[oa] (?:de )?canais|canais|receita|pre-vendas|closer|televendas|negocios|parcerias?|revops|gerente de contas|b2b|bid manager|enablement|loja)\b/i, "sales"],
  [/\b(writer|editor|content (writer|creator|strategist|manager)|journalist|translator|technical writer|proofreader|transcription|writing|redator(?:a)?|revisor(?:a)?|tradutor(?:a)?|jornalista|conteudista|jornalismo|roteirista|documentacao)\b/i, "writing"],
  [/\b(recruit(er|ing|ment)?|talent|human resources|hr|people (ops|operations|partner)|hrbp|payroll|compensation|benefits|recrutamento|recrutador(?:a)?|recursos humanos|rh|gente e gestao|departamento pessoal|administracao de pessoal|folha de pagamento|talent acquisition|remuneracao|beneficios|atracao e selecao|relacoes sindicais|dho|desenvolvimento humano)\b/i, "hr"],
  [/\b(accountant|accounting|steuerberater(in)?|pricing|actuar(y|ial)|finance|financial|controller|bookkeep(er|ing)|tax|audit(or)?|treasury|fp&a|billing|accounts (payable|receivable)|cfo|financeir[oa]|financas|contabil|contabeis|contabilidade|contador(?:a)?|fiscal|tributari[oa]|controladoria|auditoria|faturamento|tesouraria|cobranca|custos|contas a (?:receber|pagar)|conciliacao|credito|riscos?|orcamentari[oa]|controles internos|fraudes?|wealth management)\b/i, "finance"],
  [/\b(legal|lawyer|attorney|counsel|paralegal|compliance|privacy|regulatory|contracts? manager|juridico|advogad[oa]|lgpd|regulatorio|contratos)\b/i, "legal"],
  [/\b(teacher|tutor|instructor|teaching|curriculum|education|educator|professor|lecturer|trainer|professor(?:a)?|docente|instrutor(?:a)?|pedagog\w*|educacao|ensino|educacionais)\b/i, "education"],
  [/\b(nurse|nursing|physician|doctor|medical|clinical|healthcare|health care|therapist|pharmac|dental|psycholog|care assistant|caregiver|enfermagem|enfermeir[oa]|medic[oa]|saude|farmac\w*|psicolog\w*|nutricionista|fisioterapeut[ao]|odontolog\w*|dentista)\b/i, "healthcare"],
  [/\b(operations|ops|project manager|project management|office manager|executive assistant|virtual assistant|administrative|admin assistant|supply chain|logistics|procurement|chief of staff|coordinator|business analyst|consultant|strategy|strategist|category manager|shift (lead|supervisor)|administrator|operacoes|logistica|suprimentos|compras|administrativ[oa]|secretari[oa]|processos|consultor(?:a)?|consultoria|analista de negocios|business partner|comex|comercio exterior|backoffice|back office|projetos?|coordenacao|gestao de mudancas?|governanca|planejamento|estrategi[ac]\w*|assistente executiv[oa]|operacao|transformacao|comprador(?:a)?|abastecimento|importacao|facilit\w*|operador)\b/i, "operations"],
];

const SENIORITY_RULES: Rule<Seniority>[] = [
  [/\b(intern(ship)?|trainee|apprentice|werkstudent|working student|praktikum|stagiaire|student|estagio|estagiari[oa]|aprendiz)\b/i, "intern"],
  [/\b(chief|cto|ceo|cfo|coo|cmo|vp|vice president|svp|evp|head of|director|executive|diretor(?:a)?|superintendente|head)\b/i, "executive"],
  [/\b(lead|staff|principal|distinguished|architect|team lead|tech lead|lider|coordenador(?:a)?|arquitet[oa])\b/i, "lead"],
  [/\b(senior|sr\.?|snr|expert|iii|iv|especialista)\b/i, "senior"],
  [/\b(junior|jr\.?|entry[- ]level|graduate|grad|associate|new grad|i)\b/i, "junior"],
  [/\b(mid[- ]?level|mid|midweight|intermediate|ii|experienced|professional|pleno|pl(?!\/))\b/i, "mid"],
  // A bare "Manager" (after role-titles like "Account Manager" are removed)
  // is a people/area lead; "Senior Manager" was already caught above.
  [/\b(manager|gerente|gestor(?:a)?)\b/i, "lead"],
];

const EMPLOYMENT_TYPE_RULES: Rule<EmploymentType>[] = [
  [/\b(intern(ship)?|praktikum|werkstudent|working student|trainee|estagio|estagiari[oa])\b/i, "internship"],
  [/\b(freelance|freelancer)\b/i, "freelance"],
  [/\b(contract(or)?|contractual|b2b|fixed[- ]term|consultant|pj|pessoa juridica|prestador(?:a)? de servicos?)\b/i, "contract"],
  [/\b(temporary|temp|seasonal|temporari[oa])\b/i, "temporary"],
  [/\b(part[- _]?time|teilzeit|minijob|meio[- ]periodo)\b/i, "part_time"],
  [/\b(full[- _]?time|fulltime|permanent|vollzeit|cdi|regular|clt|efetivo|tempo integral)\b/i, "full_time"],
];

/**
 * Rules are written without accents and matched against accent-stripped
 * text, so Portuguese/Spanish titles work ("Sênior", "Estágio",
 * "Educação") — JavaScript's `\b` treats accented letters as non-word.
 */
function stripAccents(text: string): string {
  return text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function firstMatch<T>(rules: Rule<T>[], texts: readonly (string | null | undefined)[]): T | null {
  for (const text of texts) {
    if (!text) continue;
    const plain = stripAccents(text);
    for (const [pattern, value] of rules) {
      if (pattern.test(plain)) return value;
    }
  }
  return null;
}

/**
 * The role usually comes before a comma/dash and the team or domain after
 * it ("Product Marketing Manager, Infrastructure"), so that part decides
 * first, then the whole title, then source hints.
 */
export function classifyCategory(title: string, hints: readonly string[] = []): CategoryId {
  const role = title.split(/\s*(?:,|\s[-–—|]\s|\()/)[0] ?? title;
  return firstMatch(CATEGORY_RULES, [role, title]) ?? firstMatch(CATEGORY_RULES, hints) ?? "other";
}

/**
 * Seniority from the title first, then source hints. Returns `null` when
 * unknown rather than guessing a default level.
 */
export function classifySeniority(title: string, hints: readonly string[] = []): Seniority | null {
  // "Account Manager" / "Product Manager" are roles, not people-management
  // seniority, so "manager" only counts as lead when the title says so.
  const titleForSeniority = stripAccents(title)
    .replace(/\b(account|product|project|program|community|office|success|social media|partner|key account|channel|case|content|marketing)\s+manager\b/gi, "$1")
    .replace(/\b(?:gerente|gestor(?:a)?) de (contas|produto|projetos?|relacionamento|sucesso do cliente|comunidade|conteudo|marketing)\b/gi, "$1");
  return firstMatch(SENIORITY_RULES, [titleForSeniority]) ?? firstMatch(SENIORITY_RULES, hints);
}

export function classifyEmploymentType(title: string, hints: readonly string[] = []): EmploymentType | null {
  // Hints are structured data from the source and beat words in the title.
  return firstMatch(EMPLOYMENT_TYPE_RULES, hints) ?? firstMatch(EMPLOYMENT_TYPE_RULES, [title]);
}
