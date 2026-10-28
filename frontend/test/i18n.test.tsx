import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { JobDetailView } from '../src/components/JobDetailView';
import { JobRow } from '../src/components/JobRow';
import { detectLocale, setLocale, type Messages } from '../src/i18n';
import { en } from '../src/i18n/en';
import { ptBR } from '../src/i18n/pt-BR';
import { makeAccuracy, makeDetail, makeJob, stats } from './fixtures';

/** Every key path with the kind of value at it ("app.skipLink:string"). */
function shape(value: unknown, path = ''): string[] {
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, v]) => shape(v, path ? `${path}.${key}` : key));
  return [`${path}:${typeof value}`];
}

describe('dictionaries', () => {
  it('pt-BR has exactly the same keys as en', () => {
    // Also enforced by the `Messages` type; this catches casts and `any`.
    const typed: Messages = ptBR;
    expect(shape(typed).sort()).toEqual(shape(en).sort());
  });

  it('pt-BR translates every label (no English left behind)', () => {
    const same = shape(en)
      .filter((entry) => entry.endsWith(':string'))
      .map((entry) => entry.slice(0, entry.indexOf(':')))
      .filter((path) => {
        const get = (dict: unknown) => path.split('.').reduce<unknown>((v, key) => (v as Record<string, unknown>)[key], dict);
        return get(en) === get(ptBR);
      });
    // Words Brazilian developers use as-is.
    expect(same.sort()).toEqual(
      [
        'category.design',
        'category.marketing',
        'employmentType.freelance',
        'filters.stack',
        'periodSuffix.year',
        'results.feedLink',
        'role.stack',
        'seniority.lead',
      ].sort(),
    );
  });
});

describe('detectLocale', () => {
  it.each([
    [['pt-BR', 'en-US'], 'pt-BR'],
    [['pt'], 'pt-BR'],
    [['en-US', 'pt-PT'], 'pt-BR'],
    [['en-US', 'en'], 'en'],
    [['es-AR'], 'en'],
    [[], 'en'],
  ] as const)('%j → %s', (languages, expected) => {
    expect(detectLocale(languages)).toBe(expected);
  });
});

function stubApi(total: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith('/api/stats')
        ? stats
        : url.startsWith('/api/accuracy')
          ? makeAccuracy(0.973)
          : { jobs: [makeJob()], total, newLast7Days: 8_629, page: 1, pageSize: 20, hasMore: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

describe('Portuguese UI', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/?q=i18n');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the main page in pt-BR with Brazilian number formats', async () => {
    stubApi(20_980);
    setLocale('pt-BR');
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Vagas abertas' })).toBeInTheDocument();
    expect(await screen.findByText(/vagas encontradas/)).toHaveTextContent('20.980 vagas encontradas · 8.629 novas esta semana');
    expect(screen.getByRole('button', { name: 'Carregar mais · faltam 20.979' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Buscar vagas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assinar esta busca (feed RSS)' })).toBeInTheDocument();
    expect(screen.getByText(/^Remoto · Tempo integral · Sênior · Desenvolvimento de software/)).toBeInTheDocument();

    const sidebar = screen.getByRole('complementary', { name: 'Filtros' });
    expect(within(sidebar).getByRole('button', { name: 'Híbrido' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Presencial' })).toBeInTheDocument();
    expect(await within(sidebar).findByRole('checkbox', { name: /^Desenvolvimento de software/ })).toBeInTheDocument();
    expect(within(sidebar).getByRole('radio', { name: 'Brasil' })).toBeInTheDocument();

    expect(document.documentElement.lang).toBe('pt-BR');
    expect(document.title).toBe('job-radar · Vagas abertas, verificadas todo dia');
    expect(await screen.findByText('97% das vagas da amostra confirmadas abertas na última semana')).toBeInTheDocument();
  });

  it('switches language from the top bar and remembers the choice', async () => {
    stubApi(20_980);
    render(<App />);
    expect(await screen.findByText(/matching/)).toHaveTextContent('20,980 matching');
    expect(await screen.findByText('97% of sampled roles verified open last week')).toBeInTheDocument();

    const language = screen.getByRole('group', { name: 'Language' });
    await userEvent.click(within(language).getByRole('button', { name: 'PT' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Vagas abertas' })).toBeInTheDocument();
    expect(screen.getByText(/vagas encontradas/)).toHaveTextContent('20.980 vagas encontradas');
    expect(screen.getByText('97% das vagas da amostra confirmadas abertas na última semana')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Idioma' })).getByRole('button', { name: 'PT' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(window.localStorage.getItem('job-radar:locale')).toBe('pt-BR');

    // A fresh page load (new module instance) picks the stored choice over the browser's English.
    vi.resetModules();
    const { getLocale } = await import('../src/i18n/locale');
    expect(getLocale()).toBe('pt-BR');
  });

  it('falls back to the browser language when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['pt-BR', 'en']);
    vi.resetModules();
    const { getLocale } = await import('../src/i18n/locale');
    expect(getLocale()).toBe('pt-BR');
    vi.restoreAllMocks();
  });

  it('translates role rows and the role detail, but not job content', () => {
    setLocale('pt-BR');
    render(<JobRow job={makeJob({ applyDirect: false, sourceName: 'Himalayas' })} categoryName="x" isNew />);
    expect(screen.getByText('Nova')).toBeInTheDocument();
    expect(screen.getByText('Qualquer lugar do mundo')).toBeInTheDocument();
    expect(screen.getByText('Paga muito bem')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar Senior Frontend Engineer' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toContain('$ 150 mil – $ 180 mil');

    const job = makeDetail({ applyUrl: 'https://jobs.lever.co/acme/1', applyMethod: 'ats-discovery', url: 'https://remotive.com/x', sourceName: 'Remotive' });
    render(<JobDetailView job={job} stats={stats} variant="page" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Senior Frontend Engineer' })).toBeInTheDocument();
    expect(screen.getByText('We build things.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Candidatar-se no site da empresa/ })).toBeInTheDocument();
    expect(screen.getByText(/^Leva para/)).toHaveTextContent('Leva para jobs.lever.co, encontrada no site de vagas da própria empresa. Anunciada em Remotive.');
    expect(screen.getByRole('button', { name: 'Já me candidatei' })).toBeInTheDocument();
    expect(screen.getByText('Publicada em').nextElementSibling).toHaveTextContent('1 de out. de 2026');
    expect(screen.getByText(/^Verificada há \d+ dias$/)).toBeInTheDocument();
  });

  it('reports a closed role in pt-BR', async () => {
    setLocale('pt-BR');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'checking' }), { status: 202, headers: { 'Content-Type': 'application/json' } })));
    render(<JobDetailView job={makeDetail()} stats={stats} variant="page" />);
    await userEvent.click(screen.getByRole('button', { name: 'Vaga encerrada?' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Obrigado, estamos verificando esta vaga');
  });
});
