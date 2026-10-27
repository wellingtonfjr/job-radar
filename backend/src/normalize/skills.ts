/**
 * Detects well-known technologies so jobs can be filtered by stack. The
 * dictionary maps a canonical display name to the pattern that finds it;
 * patterns are deliberately strict (word boundaries, disambiguation) because
 * a false "Go" or "R" tag is worse than a missing one.
 */
const SKILLS: [string, RegExp][] = [
  ["JavaScript", /\bjavascript\b|(?<![.\w])js\b/i],
  ["TypeScript", /\btypescript\b/i],
  ["React", /\breact(\.js|js)?\b(?!\s+native)/i],
  ["React Native", /\breact\s+native\b/i],
  ["Next.js", /\bnext\.?js\b/i],
  ["Vue", /\bvue(\.js|js)?\b/i],
  ["Angular", /\bangular(js)?\b/i],
  ["Svelte", /\bsvelte(kit)?\b/i],
  ["Node.js", /\bnode(\.js|js)?\b/i],
  ["Python", /\bpython\b/i],
  ["Django", /\bdjango\b/i],
  ["FastAPI", /\bfastapi\b/i],
  ["Flask", /\bflask\b/i],
  ["Java", /\bjava\b(?!\s*script)/i],
  ["Spring", /\bspring\s?(boot|framework|cloud)\b|\bjava\s*\/\s*spring\b/i],
  ["Kotlin", /\bkotlin\b/i],
  ["Scala", /\bscala\b/i],
  ["Go", /\bgolang\b|\bgo\b(?=\s*(?:,|\/|and|or|developer|engineer|services|backend|programming|language|\)))/i],
  ["Rust", /\brust\b/i],
  ["C++", /\bc\+\+/i],
  ["C#", /\bc#|\bc sharp\b/i],
  [".NET", /\.net\b|\bdotnet\b/i],
  ["Ruby", /\bruby\b/i],
  ["Rails", /\brails\b/i],
  ["PHP", /\bphp\b/i],
  ["Laravel", /\blaravel\b/i],
  ["Elixir", /\belixir\b/i],
  ["Swift", /\bswift\b(?!\s*code)/i],
  ["iOS", /\bios\b/i],
  ["Android", /\bandroid\b/i],
  ["Flutter", /\bflutter\b/i],
  ["SQL", /\bsql\b/i],
  ["PostgreSQL", /\bpostgres(ql)?\b/i],
  ["MySQL", /\bmysql\b/i],
  ["MongoDB", /\bmongo(db)?\b/i],
  ["Redis", /\bredis\b/i],
  ["Kafka", /\bkafka\b/i],
  ["GraphQL", /\bgraphql\b/i],
  ["AWS", /\baws\b|\bamazon web services\b/i],
  // "GCP" is also Good Clinical Practice, so only trust it next to cloud words.
  ["GCP", /\bgoogle cloud\b|\bgcp\b(?=[\s\S]{0,300}\b(aws|azure|cloud|bigquery|kubernetes|terraform)\b)|\b(aws|azure|cloud|bigquery|kubernetes|terraform)\b[\s\S]{0,300}\bgcp\b/i],
  ["Azure", /\bazure\b/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\bkubernetes\b|\bk8s\b/i],
  ["Terraform", /\bterraform\b/i],
  ["Linux", /\blinux\b/i],
  ["Spark", /\bapache spark\b|\bpyspark\b|\bspark\s?(sql|streaming)\b|\bspark\b(?=\s*(,|\/|and|or)\s*(hadoop|kafka|scala|databricks|flink|hive))|\b(hadoop|kafka|scala|databricks|flink|hive)\s*(,|\/|and|or)\s*spark\b/i],
  ["Airflow", /\bairflow\b/i],
  ["dbt", /\bdbt\b/i],
  ["Snowflake", /\bsnowflake\b/i],
  ["PyTorch", /\bpytorch\b/i],
  ["TensorFlow", /\btensorflow\b/i],
  ["LLM", /\bllms?\b|\blarge language models?\b/i],
  ["Figma", /\bfigma\b/i],
  ["Salesforce", /\bsalesforce\b/i],
];

export function extractSkills(title: string, tags: readonly string[], description: string | null): string[] {
  const text = [title, tags.join(", "), description ?? ""].join("\n");
  return SKILLS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
