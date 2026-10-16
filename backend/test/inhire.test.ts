import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyCategory, classifyEmploymentType, classifySeniority } from "../src/normalize/classify.js";
import { isOpening, normalizeJob } from "../src/normalize/index.js";
import { inferWorkplace, parseAllowedCountries } from "../src/normalize/location.js";
import { cleanInhireTitle, expandCountryCode, inhireSlug, inhireSource, toRawJob } from "../src/sources/inhire.js";

const board = { token: "acme", name: "Acme" };

describe("InHire mapping", () => {
  it("expands the trailing ISO country code", () => {
    expect(expandCountryCode("Joinville, SC, BR")).toBe("Joinville, SC, Brazil");
    expect(expandCountryCode("BR")).toBe("Brazil");
    expect(expandCountryCode("São Paulo")).toBe("São Paulo");
  });

  it("builds slugs the way InHire's career pages do", () => {
    expect(inhireSlug("Programa de Estágio Radix | Geração Desafio")).toBe("programa-de-estagio-radix-or-geracao-desafio");
    expect(inhireSlug("Profissional BA Tech Lead")).toBe("profissional-ba-tech-lead");
    expect(inhireSlug("???")).toBe("vaga");
  });

  it("drops requisition codes from titles", () => {
    expect(cleanInhireTitle("3606: CONSULTOR SAP MM")).toBe("CONSULTOR SAP MM");
    expect(cleanInhireTitle("81C5: Analista de Negócios - Sr")).toBe("Analista de Negócios - Sr");
    expect(cleanInhireTitle("Dev Java: Pleno")).toBe("Dev Java: Pleno");
  });

  it("builds a normalized Brazilian job", () => {
    const raw = toRawJob(
      board,
      { jobId: "8acfabbc-1903-434e-b552-033b335fb888", displayName: "Desenvolvedor(a) Back-end Java Sênior", workplaceType: "Hybrid", location: "Belém, PA, BR" },
      { jobId: "8acfabbc-1903-434e-b552-033b335fb888", displayName: "Desenvolvedor(a) Back-end Java Sênior", contractType: ["CLT"], publishedAt: "2026-10-14T19:28:37.850Z", description: "<p>Java e Spring Boot</p>" },
    );
    expect(raw.url).toBe("https://acme.inhire.app/vagas/8acfabbc-1903-434e-b552-033b335fb888/desenvolvedor-a-back-end-java-senior");
    const job = normalizeJob("inhire", "acme", raw);
    expect(job).toMatchObject({
      workplace: "hybrid",
      // "PA" is Pará here, not Pennsylvania.
      allowedCountries: ["BR"],
      category: "software-development",
      seniority: "senior",
      employmentType: "full_time",
      postedAt: "2026-10-14T19:28:37.850Z",
    });
  });

  it("treats remote BRL roles without a location as Brazil-only", () => {
    const job = normalizeJob("inhire", "acme", toRawJob(board, { jobId: "1", displayName: "Analista", workplaceType: "Remote", location: "" }, { jobId: "1", displayName: "Analista", salaryCurrency: "BRL" }));
    expect(job.allowedCountries).toEqual(["BR"]);
    expect(job.workplace).toBe("remote");
  });
});

describe("InHire adapter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ingests only remote/hybrid roles and keeps a job when its detail request fails", async () => {
    const list = {
      jobsPage: [
        { jobId: "a", displayName: "Engenheiro(a) de Dados", workplaceType: "Remote", location: "BR", status: "published" },
        { jobId: "b", displayName: "Tutor de Enfermagem", workplaceType: "On-site", location: "Morada Nova, CE, BR", status: "published" },
        { jobId: "c", displayName: "Analista de Suporte", workplaceType: "Hybrid", location: "Recife, PE, BR", status: "published" },
      ],
    };
    const seen: { url: string; tenant: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        const tenant = (init.headers as Record<string, string>)["X-Tenant"] ?? null;
        seen.push({ url, tenant });
        if (url.endsWith("/pages")) return new Response(JSON.stringify(list));
        if (url.endsWith("/a")) return new Response(JSON.stringify({ jobId: "a", displayName: "Engenheiro(a) de Dados", description: "<p>Spark</p>", contractType: ["PJ"] }));
        return new Response("boom", { status: 500 });
      }),
    );
    vi.spyOn(await import("../src/sources/companies.js"), "INHIRE_BOARDS", "get").mockReturnValue([board]);

    const outcome = await inhireSource.fetchJobs();
    expect(outcome.errors).toEqual([]);
    const [feed] = outcome.results;
    expect(feed).toMatchObject({ feed: "acme", complete: true });
    expect(feed?.jobs.map((j) => j.externalId)).toEqual(["a", "c"]);
    expect(feed?.jobs[0]).toMatchObject({ descriptionHtml: "<p>Spark</p>", employmentTypeHints: ["PJ"] });
    expect(feed?.jobs[1]).toMatchObject({ title: "Analista de Suporte", descriptionHtml: null });
    expect(seen.every((r) => r.tenant === "acme")).toBe(true);
    expect(seen.some((r) => r.url.endsWith("/b"))).toBe(false);
  });
});

describe("Portuguese titles", () => {
  it.each([
    ["Desenvolvedor(a) Back-end Java", "software-development"],
    ["Engenheiro(a) de Dados Sênior (Arquitetura, Pipelines & Big Data)", "data"],
    ["Cientista de dados", "data"],
    ["Analista de Infraestrutura - SRE PL (Remoto)", "devops"],
    ["Gerente de Projetos de Software", "operations"],
    ["Analista de Suporte ao Cliente", "customer-support"],
    ["Executivo(a) de Contas", "sales"],
    ["Analista de Recrutamento e Seleção", "hr"],
    ["Analista Contábil", "finance"],
    ["Advogado(a) Trabalhista", "legal"],
    ["Professor (a) Mediador - Educação Física (Remoto)", "education"],
    ["Enfermeiro(a) Assistencial", "healthcare"],
    ["Analista de Segurança da Informação", "security"],
    ["Analista de Testes", "qa"],
    ["Gestor de Tráfego - Sênior", "marketing"],
    ["Líder de Tecnologia - Salesforce", "software-development"],
    ["Especialista Cloud – Azure | AWS", "devops"],
    ["Executivo Canais IV", "sales"],
    ["Estilista Júnior | Acessórios", "design"],
    ["Growth Lead", "marketing"],
    ["Growth Account Executive", "sales"],
  ])("category of %s", (title, expected) => {
    expect(classifyCategory(title)).toBe(expected);
  });

  it.each([
    ["Desenvolvedor Pleno", "mid"],
    ["Analista de Infraestrutura - SRE PL (Remoto)", "mid"],
    ["Analista PL/SQL Sênior", "senior"],
    ["Designer - Júnior", "junior"],
    ["Estágio em Engenharia de Software", "intern"],
    ["Coordenador(a) de Operações", "lead"],
    ["Diretor(a) CTO AWS - Banking", "executive"],
    ["Especialista Microsoft Entra ID", "senior"],
    ["Gerente de Contas", null],
  ])("seniority of %s", (title, expected) => {
    expect(classifySeniority(title)).toBe(expected);
  });

  it("maps Brazilian contract types", () => {
    expect(classifyEmploymentType("x", ["CLT"])).toBe("full_time");
    expect(classifyEmploymentType("x", ["PJ"])).toBe("contract");
    expect(classifyEmploymentType("Estágio em Dados")).toBe("internship");
    expect(classifyEmploymentType("Analista (Temporário)")).toBe("temporary");
  });

  it("recognizes Portuguese work modes and Brazilian cities", () => {
    expect(inferWorkplace(null, ["Híbrido - São Paulo"], "Analista")).toBe("hybrid");
    expect(inferWorkplace(null, [], "Analista de Dados (Remoto)")).toBe("remote");
    expect(parseAllowedCountries(["Curitiba"])).toEqual(["BR"]);
    expect(parseAllowedCountries(["Austin, TX"])).toEqual(["US"]);
  });
});

describe("isOpening", () => {
  it("rejects résumé pools in Portuguese and English", () => {
    expect(isOpening("BANCO DE TALENTOS EXCLUSIVO PARA PESSOAS PRETAS")).toBe(false);
    expect(isOpening("[DBServices Portugal] Talent Pool - Quality Assurance")).toBe(false);
    expect(isOpening("General Application")).toBe(false);
    expect(isOpening("Talent Acquisition Partner")).toBe(true);
    expect(isOpening("Desenvolvedor Pleno")).toBe(true);
  });
});
