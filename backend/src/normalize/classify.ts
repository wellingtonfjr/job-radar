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
  [/\b(machine learning|ml engineer|mlops|ai engineer|ai researcher|artificial intelligence|llm|deep learning|computer vision|nlp|applied scientist|research scientist|ai\/ml|applied ai|generative ai|genai)\b/i, "ai-ml"],
  [/\b(security|secops|appsec|infosec|penetration|soc analyst|cyber)\b/i, "security"],
  [/\b(devops|sre|site reliability|platform engineer|infrastructure|cloud engineer|cloud architect|systems? administrator|sysadmin|network engineer|kubernetes|devsecops|it support|helpdesk|help desk|service desk|it administrator|it engineer|information technology)\b/i, "devops"],
  [/\b(qa|quality assurance|test(ing)? engineer|sdet|tester|test automation)\b/i, "qa"],
  [/\b(data scientist|data analyst|data engineer|analytics|business intelligence|bi developer|bi analyst|data architect|database administrator|dba|statistician|data and analytics|data)\b/i, "data"],
  [/\b(product manager|product owner|product lead|head of product|vp of product|product management|group product|product operations|technical program manager|program manager)\b/i, "product"],
  [/\b(designer|design lead|ux|ui\/ux|user experience|user researcher|ux researcher|illustrator|art director|creative director|motion|brand design|design)\b/i, "design"],
  // Engineer-titled roles that belong to non-engineering functions.
  [/\b(sales engineer|solutions? (engineer|consultant)|pre-?sales)\b/i, "sales"],
  [/\b(support engineer|technical support|customer success engineer)\b/i, "customer-support"],
  [/\b(software|developer|entwickler(in)?|softwareentwickler(\*in)?|engineer(ing)?|programmer|frontend|front-end|front end|backend|back-end|back end|full[- ]?stack|mobile|ios|android|web developer|architect|cto|tech lead|swe|golang|python|java|javascript|typescript|react|ruby|php|\.net|rust|scala|elixir|salesforce developer|blockchain|embedded|firmware|game developer)\b/i, "software-development"],
  [/\b(customer (support|service|success|experience|care)|support (agent|specialist|engineer|representative)|technical support|client success|call center|customer happiness|cx|support)\b/i, "customer-support"],
  [/\b(marketing|seo|sem|content marketing|social media|brand|communications|pr manager|public relations|demand gen|community manager|performance marketing|copywriter)\b/i, "marketing"],
  [/\b(account executive|sales|verkauf|vertrieb|\w*verkaufs\w*|business development|bdr|sdr|account manager|partnerships?|revenue|pre-?sales|solutions? consultant|solutions? engineer|go-to-market|gtm|channel manager|key account)\b/i, "sales"],
  [/\b(writer|editor|content (writer|creator|strategist|manager)|journalist|translator|technical writer|proofreader|transcription|writing)\b/i, "writing"],
  [/\b(recruit(er|ing|ment)?|talent|human resources|hr|people (ops|operations|partner)|hrbp|payroll|compensation|benefits)\b/i, "hr"],
  [/\b(accountant|accounting|steuerberater(in)?|pricing|actuar(y|ial)|finance|financial|controller|bookkeep(er|ing)|tax|audit(or)?|treasury|fp&a|billing|accounts (payable|receivable)|cfo)\b/i, "finance"],
  [/\b(legal|lawyer|attorney|counsel|paralegal|compliance|privacy|regulatory|contracts? manager)\b/i, "legal"],
  [/\b(teacher|tutor|instructor|teaching|curriculum|education|educator|professor|lecturer|trainer)\b/i, "education"],
  [/\b(nurse|nursing|physician|doctor|medical|clinical|healthcare|health care|therapist|pharmac|dental|psycholog|care assistant|caregiver)\b/i, "healthcare"],
  [/\b(operations|ops|project manager|project management|office manager|executive assistant|virtual assistant|administrative|admin assistant|supply chain|logistics|procurement|chief of staff|coordinator|business analyst|consultant|strategy|strategist|category manager|shift (lead|supervisor)|administrator)\b/i, "operations"],
];

const SENIORITY_RULES: Rule<Seniority>[] = [
  [/\b(intern(ship)?|trainee|apprentice|werkstudent|working student|praktikum|stagiaire|student)\b/i, "intern"],
  [/\b(chief|cto|ceo|cfo|coo|cmo|vp|vice president|svp|evp|head of|director|executive)\b/i, "executive"],
  [/\b(lead|staff|principal|distinguished|architect|team lead|tech lead)\b/i, "lead"],
  [/\b(senior|sr\.?|snr|expert|iii|iv)\b/i, "senior"],
  [/\b(junior|jr\.?|entry[- ]level|graduate|grad|associate|new grad|i)\b/i, "junior"],
  [/\b(mid[- ]?level|mid|midweight|intermediate|ii|experienced|professional)\b/i, "mid"],
  // A bare "Manager" (after role-titles like "Account Manager" are removed)
  // is a people/area lead; "Senior Manager" was already caught above.
  [/\bmanager\b/i, "lead"],
];

const EMPLOYMENT_TYPE_RULES: Rule<EmploymentType>[] = [
  [/\b(intern(ship)?|praktikum|werkstudent|working student|trainee)\b/i, "internship"],
  [/\b(freelance|freelancer)\b/i, "freelance"],
  [/\b(contract(or)?|contractual|b2b|fixed[- ]term|consultant)\b/i, "contract"],
  [/\b(temporary|temp|seasonal)\b/i, "temporary"],
  [/\b(part[- _]?time|teilzeit|minijob)\b/i, "part_time"],
  [/\b(full[- _]?time|fulltime|permanent|vollzeit|cdi|regular)\b/i, "full_time"],
];

function firstMatch<T>(rules: Rule<T>[], texts: readonly (string | null | undefined)[]): T | null {
  for (const text of texts) {
    if (!text) continue;
    for (const [pattern, value] of rules) {
      if (pattern.test(text)) return value;
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
  const titleForSeniority = title.replace(/\b(account|product|project|program|community|office|success|social media|partner|key account|channel|case|content|marketing)\s+manager\b/gi, "$1");
  return firstMatch(SENIORITY_RULES, [titleForSeniority]) ?? firstMatch(SENIORITY_RULES, hints);
}

export function classifyEmploymentType(title: string, hints: readonly string[] = []): EmploymentType | null {
  // Hints are structured data from the source and beat words in the title.
  return firstMatch(EMPLOYMENT_TYPE_RULES, hints) ?? firstMatch(EMPLOYMENT_TYPE_RULES, [title]);
}
