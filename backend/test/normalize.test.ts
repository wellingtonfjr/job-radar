import { describe, expect, it } from "vitest";
import { classifyCategory, classifyEmploymentType, classifySeniority } from "../src/normalize/classify.js";
import { htmlToText } from "../src/normalize/html.js";
import { fingerprint, normalizeJob } from "../src/normalize/index.js";
import { inferWorkplace, parseAllowedCountries, splitLocations } from "../src/normalize/location.js";
import { annualUsd, extractSalaryFromDescription, parseSalaryText } from "../src/normalize/salary.js";
import { extractSkills } from "../src/normalize/skills.js";
import { toSearchKey } from "../src/normalize/text.js";

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
    ["Softwareentwickler*in Web", "software-development"],
    ["Forklift Operator", "other"],
  ])("category of %s", (title, expected) => {
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
    expect(extractSkills("Clinical Trial Manager", [], "Knowledge of GCP and ICH guidelines")).toEqual([]);
    expect(extractSkills("Platform Engineer", [], "Experience with GCP or AWS")).toEqual(["AWS", "GCP"]);
    expect(extractSkills("Experiential Producer", [], "Ideas that spark joy")).toEqual([]);
    expect(extractSkills("Data Engineer", [], "Kafka and Spark pipelines")).toEqual(["Kafka", "Spark"]);
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
    expect(Date.parse(job.postedAt as string)).toBeLessThanOrEqual(Date.now());
  });
});
