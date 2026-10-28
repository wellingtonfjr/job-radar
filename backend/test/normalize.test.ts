import type { RawJob } from "../src/domain/job.js";
import { describe, expect, it } from "vitest";
import { classifyCategory, classifyEmploymentType, classifySeniority } from "../src/normalize/classify.js";
import { htmlToText } from "../src/normalize/html.js";
import { fingerprint, isOpening, normalizeJob } from "../src/normalize/index.js";
import { detectLanguage } from "../src/normalize/language.js";
import { inferWorkplace, parseAllowedCountries, splitLocations, withoutWorkModes } from "../src/normalize/location.js";
import { annualUsd, extractSalaryFromDescription, parseSalaryText } from "../src/normalize/salary.js";
import { extractSkills } from "../src/normalize/skills.js";
import { toSearchKey } from "../src/normalize/text.js";
import { safeUrl } from "../src/normalize/url.js";

describe("parseSalaryText", () => {
  it.each([
    ["$170k - $200k", { min: 170_000, max: 200_000, currency: "USD", period: "year" }],
    ["$35,3k- $52k", { min: 35_300, max: 52_000, currency: "USD", period: "year" }],
    ["$50-$75 /hour", { min: 50, max: 75, currency: "USD", period: "hour" }],
    ["£13.50 - £14.00 per hour", { min: 13.5, max: 14, currency: "GBP", period: "hour" }],
    ["eur 80,000 - 110,000", { min: 80_000, max: 110_000, currency: "EUR", period: "year" }],
    ["143913 usd/year", { min: 143_913, max: null, currency: "USD", period: "year" }],
    ["€60.000 – €80.000", { min: 60_000, max: 80_000, currency: "EUR", period: "year" }],
  ])("salary case %#", (text, expected) => {
    expect(parseSalaryText(text)).toEqual(expected);
  });

  it("returns null without numbers", () => {
    expect(parseSalaryText("Competitive")).toBeNull();
    expect(parseSalaryText("")).toBeNull();
  });
});

describe("extractSalaryFromDescription", () => {
  it("finds a pay-transparency range after a salary keyword", () => {
    const text = "Benefits...\nThe base salary range for this role is $150,000 – $190,000 USD per year, plus equity.";
    expect(extractSalaryFromDescription(text)).toEqual({ min: 150_000, max: 190_000, currency: "USD", period: "year" });
  });

  it("ignores money ranges that aren't about pay", () => {
    expect(extractSalaryFromDescription("We raised $20,000,000 - $30,000,000 in our Series B.")).toBeNull();
  });

  it("ignores implausible values", () => {
    expect(extractSalaryFromDescription("Salary: $1 - $2")).toBeNull();
  });
});

describe("annualUsd", () => {
  it("annualizes and converts", () => {
    expect(annualUsd({ min: 50, max: 75, currency: "USD", period: "hour" })).toBe(104_000);
    expect(annualUsd({ min: 100_000, max: null, currency: "EUR", period: "year" })).toBe(108_000);
    expect(annualUsd({ min: null, max: null, currency: "USD", period: "year" })).toBeNull();
    expect(annualUsd({ min: 1000, max: null, currency: "XYZ", period: "year" })).toBeNull();
  });
});

describe("parseAllowedCountries", () => {
  it.each<[string[], string[] | null]>([
    [["Worldwide"], null],
    [["Remote - Worldwide"], null],
    [["USA", "Worldwide"], null],
    [["Anywhere in Europe"], expect.arrayContaining(["PT", "DE", "PL"]) as unknown as string[]],
    [["Remote, United States"], ["US"]],
    [["San Francisco, CA"], ["US"]],
    [["Berlin"], ["DE"]],
    [["Toronto, Canada"], ["CA"]],
    [["Bonn"], null],
    [["LATAM"], expect.arrayContaining(["BR", "MX", "AR"]) as unknown as string[]],
    [["Americas, Israel"], expect.arrayContaining(["US", "BR", "IL"]) as unknown as string[]],
    [["Washington, D.C."], ["US"]],
    [["Washington DC"], ["US"]],
    [["Hybrid"], null],
  ])("%j", (input, expected) => {
    expect(parseAllowedCountries(input)).toEqual(expected);
  });

  it("does not match country codes inside words", () => {
    expect(parseAllowedCountries(["Bonus based"])).toBeNull();
  });
});

describe("inferWorkplace", () => {
  it("prefers explicit values but detects hybrid", () => {
    expect(inferWorkplace("remote", ["Berlin"], "Engineer")).toBe("remote");
    expect(inferWorkplace("onsite", ["Berlin (Hybrid)"], "Engineer")).toBe("hybrid");
    expect(inferWorkplace(null, ["Remote, US"], "Engineer")).toBe("remote");
    expect(inferWorkplace(null, ["London"], "Engineer")).toBe("onsite");
    expect(inferWorkplace(null, [], "Engineer (Remote)")).toBe("remote");
  });
});

describe("withoutWorkModes", () => {
  it("drops entries that only name a work mode, not a place", () => {
    expect(withoutWorkModes(["Hybrid", "London", "Remote", "On-site", "(Remoto)", "Fully Remote", "Híbrido"])).toEqual(["London"]);
    expect(withoutWorkModes(["Hybrid - Berlin", "Remote, US", "Remote Sensing Lab, Oslo"])).toEqual([
      "Hybrid - Berlin",
      "Remote, US",
      "Remote Sensing Lab, Oslo",
    ]);
  });
});

describe("splitLocations", () => {
  it("keeps a city/state/country together but splits alternatives", () => {
    expect(splitLocations("San Francisco, CA")).toEqual(["San Francisco, CA"]);
    expect(splitLocations("London; Remote, UK")).toEqual(["London", "Remote, UK"]);
    expect(splitLocations("  ")).toEqual([]);
  });
});

describe("classification", () => {
  it.each([
    ["Senior Frontend Engineer", "software-development"],
    ["Machine Learning Engineer", "ai-ml"],
    ["AI Engineer", "ai-ml"],
    ["Senior Software Engineer (Full Stack | Node.js & React | AI Focus)", "software-development"],
    ["Site Reliability Engineer", "devops"],
    ["Sales Engineer", "sales"],
    ["Product Designer", "design"],
    ["Senior Product Manager", "product"],
    ["Customer Success Manager", "customer-support"],
    ["Support Associate (remote)", "customer-support"],
    ["Recruiter", "hr"],
    ["Events and Partnership Marketing Manager", "marketing"],
    ["Partnerships Manager", "sales"],
    ["Senior Product Marketing Manager, Infrastructure", "marketing"],
    ["Data Engineer, Marketing", "data"],
    ["Softwareentwickler*in Web", "software-development"],
    ["Forklift Operator", "other"],
    ["Cybersecurity Lead - Sênior (Remoto)", "security"],
  ])("category of %s", (title, expected) => {
    expect(classifyCategory(title)).toBe(expected);
  });

  // InHire titles that used to land in "other" (#6).
  it.each([
    ["Analista de Contas a Receber Pl.", "finance"],
    ["Analista de Risco de crédito", "finance"],
    ["Gerente de Transformação e Projetos Digitais", "operations"],
    ["Analista de Projetos Pleno", "operations"],
    ["Coordenador(a) de Sistemas (Desenvolvimento para Portais)", "software-development"],
    ["Profissional de Desenvolvimento Júnior", "software-development"],
    ["Arquiteto Corporativo Sênior | Híbrido | Blumenau/SC", "software-development"],
    ["SAP SD Sênior / Especialista", "software-development"],
    ["Especialista de Plataforma de IA", "ai-ml"],
    ["Engenheiro(a) de Automação e IA Sênior", "ai-ml"],
    ["Analista de Governança de TI Pleno", "devops"],
    ["Coordenador(a) de FinOps", "devops"],
    ["Analista de Analytic Sênior - Remoto", "data"],
    ["Analista de Produtos Sênior", "product"],
    ["PO — E-commerce e B2B", "product"],
    ["Analista de Implantação Sênior | Remoto", "customer-support"],
    ["Analista de Marketplace Júnior", "marketing"],
    ["Analista de CRM | CRM & Martech", "marketing"],
    ["Gerente de Contas Sr- Foco Shopee", "sales"],
    ["Especialista Desenvolvimento de Negócios I (Aquisição)", "sales"],
    ["Analista de Remuneração e Benefícios Pleno", "hr"],
    ["Analista de Contratos Sênior", "legal"],
    ["Roteirista Pleno", "writing"],
    ["Especialista Red Team", "security"],
    ["Profissional de Engenharia Mecânica", "other"],
  ])("pt-BR category of %s", (title, expected) => {
    expect(classifyCategory(title)).toBe(expected);
  });

  it("falls back to source hints", () => {
    expect(classifyCategory("Forward Deployed Specialist", ["Marketing"])).toBe("marketing");
  });

  it.each([
    ["Senior Software Engineer", "senior"],
    ["Staff Engineer", "lead"],
    ["Engineering Manager", "lead"],
    ["Senior Category Manager", "senior"],
    ["Account Manager", null],
    ["Junior Developer", "junior"],
    ["VP of Engineering", "executive"],
    ["Software Engineering Intern", "intern"],
    ["Software Engineer II", "mid"],
    ["Software Engineer", null],
    ["Desenvolvedor Backend Júnior", "junior"],
    ["Analista de Marketing Pleno", "mid"],
    ["Analista Financeiro PL", "mid"],
    ["Engenheira de Dados Sênior", "senior"],
    ["Analista N3 Produção (PL/SQL)", null],
  ])("seniority of %s", (title, expected) => {
    expect(classifySeniority(title)).toBe(expected);
  });

  it("uses source hints for employment type before the title", () => {
    expect(classifyEmploymentType("Engineer", ["full_time"])).toBe("full_time");
    expect(classifyEmploymentType("Contract Designer")).toBe("contract");
    expect(classifyEmploymentType("Engineer")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("keeps paragraphs and bullets and drops markup", () => {
    const html = "<h2>About</h2><p>We&nbsp;build &amp; ship.</p><ul><li>React</li><li>Node</li></ul><script>alert(1)</script>";
    expect(htmlToText(html)).toBe("About\n\nWe build & ship.\n• React\n• Node");
  });

  it("decodes accented-letter entities (Portuguese descriptions)", () => {
    expect(htmlToText("<p>Voc&ecirc; vai atuar na Solu&ccedil;&atilde;o &Uacute;nica &agrave; dist&acirc;ncia &ndash; 1&ordm; lugar</p>")).toBe(
      "Você vai atuar na Solução Única à distância – 1º lugar",
    );
  });

  it("decodes arrows, spacing and Greek letters but leaves non-entities alone", () => {
    expect(htmlToText("<p>A&emsp;&rarr; B &le; &beta;&sigma;&omega; &Delta; Q&A;</p>")).toBe("A → B ≤ βσω Δ Q&A;");
  });

  it("decodes entity-encoded HTML", () => {
    expect(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;")).toBe("Hello & welcome");
  });
});

describe("extractSkills", () => {
  it("detects technologies without false friends", () => {
    expect(extractSkills("Senior React Developer", [], "We use TypeScript, Node.js and PostgreSQL on AWS.")).toEqual(
      ["TypeScript", "React", "Node.js", "PostgreSQL", "AWS"],
    );
    expect(extractSkills("Java Engineer", [], "JavaScript is not required")).toEqual(["JavaScript", "Java"]);
    expect(extractSkills("Account Executive", [], "Go win deals and let's go!")).toEqual([]);
    expect(extractSkills("Creative Strategist", [], "Content on the go, and ideas. Go, and make it happen.")).toEqual([]);
    expect(extractSkills("Backend Engineer", [], "Our services are written in Go, Rust and Python.")).toEqual(["Python", "Go", "Rust"]);
    expect(extractSkills("Go Developer", [], "Build APIs")).toEqual(["Go"]);
    expect(extractSkills("Engineer", [], "We use golang")).toEqual(["Go"]);
    expect(extractSkills("Clinical Trial Manager", [], "Knowledge of GCP and ICH guidelines")).toEqual([]);
    expect(extractSkills("Platform Engineer", [], "Experience with GCP or AWS")).toEqual(["AWS", "GCP"]);
    expect(extractSkills("Experiential Producer", [], "Ideas that spark joy")).toEqual([]);
    expect(extractSkills("Data Engineer", [], "Kafka and Spark pipelines")).toEqual(["Kafka", "Spark"]);
  });
});

describe("detectLanguage", () => {
  it.each([
    ["We are looking for an engineer who will join our team and work with you on the platform.", "en"],
    ["Wir suchen eine erfahrene Person für unser Team in Berlin, die mit uns die Plattform weiterentwickelt und auch Verantwortung übernimmt.", "de"],
    ["Wij zoeken een collega voor ons team. Je werkt met een groep van experts aan het platform en bent ook verantwoordelijk voor de planning.", "nl"],
    ["Nous recherchons une personne pour notre équipe. Vous travaillerez avec les équipes produit et des clients sur la plateforme.", "fr"],
    ["Buscamos una persona para nuestro equipo con experiencia en ventas y por eso los candidatos con inglés son bienvenidos.", "es"],
    ["Estamos em busca de uma pessoa para a vaga de analista com foco em dados e você vai trabalhar com os times da empresa na área.", "pt"],
    ["Senior Engineer", null],
    ["", null],
  ])("%s", (text, expected) => {
    expect(detectLanguage(text)).toBe(expected);
  });
});

describe("isOpening", () => {
  it.each([
    ["Initiativbewerbung (m/w/d)", false],
    ["Spontaneous Application", false],
    ["Initiative application - Engineering", false],
    ["Candidature spontanée", false],
    ["BANCO TALENTOS - SOLUTIS", false],
    ["VR Futuras Oportunidades", false],
    ["Senior Backend Engineer", true],
    ["Application Engineer", true],
  ])("%s → %s", (title, expected) => {
    expect(isOpening(title)).toBe(expected);
  });
});

describe("fingerprint & search key", () => {
  it("matches cosmetic variants of the same opening", () => {
    expect(fingerprint("Acme, Inc.", "Senior Engineer (Remote)")).toBe(fingerprint("ACME", "Senior Engineer - EMEA"));
    expect(fingerprint("Acme", "Senior Engineer")).not.toBe(fingerprint("Acme", "Staff Engineer"));
  });

  it("is spelling-insensitive", () => {
    expect(toSearchKey("Front-End Next.js")).toBe(toSearchKey("frontend nextjs"));
  });
});

describe("normalizeJob", () => {
  it("produces a complete record", () => {
    const job = normalizeJob("remotive", "all", {
      externalId: "1",
      title: "Senior React Engineer",
      company: "Acme",
      url: "https://example.com/1",
      locations: ["USA", "Canada"],
      workplace: "remote",
      descriptionHtml: "<p>React and TypeScript</p>",
      salaryText: "$170k - $200k",
      postedAt: "2999-01-01T00:00:00Z",
    });
    expect(job).toMatchObject({
      id: "remotive:1",
      category: "software-development",
      seniority: "senior",
      workplace: "remote",
      allowedCountries: ["CA", "US"],
      salary: { min: 170_000, max: 200_000, currency: "USD", period: "year" },
      salaryMinUsdYear: 170_000,
      skills: ["TypeScript", "React"],
      description: "React and TypeScript",
    });
    // Future dates are clamped to "now".
    expect(job.locations).toEqual(["USA", "Canada"]);
    expect(Date.parse(job.postedAt as string)).toBeLessThanOrEqual(Date.now());
  });
});

describe("safeUrl", () => {
  it.each([
    ["https://boards.greenhouse.io/acme/jobs/1?gh_jid=1#apply", "https://boards.greenhouse.io/acme/jobs/1?gh_jid=1#apply"],
    ["  https://acme.com/jobs/1  ", "https://acme.com/jobs/1"],
    ["http://acme.com/jobs/1", "https://acme.com/jobs/1"],
    ["https://acme.com/jobs?a=1&amp;b=2", "https://acme.com/jobs?a=1&b=2"],
    ["https://user:secret@evil.example/login", "https://evil.example/login"],
  ])("keeps web address %s", (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });

  it.each([
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "ftp://acme.com/file",
    "/relative/path",
    "not a url",
    "",
  ])("rejects %s", (input) => {
    expect(safeUrl(input)).toBeNull();
  });

  it("can refuse plain http instead of upgrading it", () => {
    expect(safeUrl("http://acme.com/jobs/1", { upgradeHttp: false })).toBeNull();
  });

  it("is applied when normalizing source jobs", () => {
    const base: Omit<RawJob, "url"> = { externalId: "1", title: "Engineer", company: "Acme", locations: [], workplace: null };
    expect(normalizeJob("x", "all", { ...base, url: "javascript:alert(1)" }).url).toBe("");
    expect(normalizeJob("x", "all", { ...base, url: "https://acme.com/1", companyLogo: "data:image/svg+xml,<svg onload=alert(1)>" }).companyLogo).toBeNull();
    expect(normalizeJob("x", "all", { ...base, url: "https://acme.com/1", companyLogo: "http://cdn.acme.com/logo.png" }).companyLogo).toBe("https://cdn.acme.com/logo.png");
  });
});

describe("normalizeJob locations", () => {
  const base: RawJob = { externalId: "1", title: "Engineer", company: "Acme", url: "https://example.com/1", locations: [], workplace: null };

  it("keeps a work-mode-only location as the workplace, not as a place", () => {
    const job = normalizeJob("greenhouse", "acme", { ...base, locations: ["Hybrid", "London"] });
    expect(job).toMatchObject({ workplace: "hybrid", locations: ["London"], allowedCountries: ["GB"] });
  });

  it("maps Washington, D.C. to the US", () => {
    expect(normalizeJob("lever", "acme", { ...base, locations: ["Washington, D.C."] }).allowedCountries).toEqual(["US"]);
  });
});
