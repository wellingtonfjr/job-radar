import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveFilters } from '../src/components/ActiveFilters';
import { FilterPanel } from '../src/components/FilterPanel';
import { JobDetailView } from '../src/components/JobDetailView';
import { JobRow } from '../src/components/JobRow';
import { SourcesFooter } from '../src/components/SourcesFooter';
import { EMPTY_FILTERS } from '../src/lib/filters';
import { makeDetail, makeJob, stats } from './fixtures';

describe('JobRow', () => {
  it('links to the detail page and shows the normalized facts', () => {
    render(<JobRow job={makeJob()} categoryName="Software Development" isNew={false} />);
    expect(screen.getByRole('link', { name: 'Senior Frontend Engineer' })).toHaveAttribute('href', '/jobs/greenhouse%3A1');
    expect(screen.getByText(/Remote · Full-time · Senior · Software Development/)).toBeInTheDocument();
    expect(screen.getByText('Worldwide')).toBeInTheDocument();
    const chips = within(screen.getByRole('list', { name: 'Salary and stack' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(chips).toEqual(['$150K – $180K', 'TypeScript', 'React']);
    expect(screen.getByText('Top pay')).toBeInTheDocument();
  });

  it('shows cleaned locations, a New flag, and hides the catch-all category', () => {
    render(
      <JobRow
        job={makeJob({ workplace: 'hybrid', locations: ['Germany (Hybrid)'], allowedCountries: ['DE'], companyTier: null, category: 'other' })}
        categoryName="All Others"
        isNew
      />,
    );
    expect(screen.getByText('Germany')).toBeInTheDocument();
    expect(screen.queryByText(/All Others/)).not.toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.queryByText(/pay$/)).not.toBeInTheDocument();
  });

  it('selects instead of navigating when used in the split view', async () => {
    const onSelect = vi.fn();
    render(<JobRow job={makeJob()} categoryName="x" isNew={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('link', { name: 'Senior Frontend Engineer' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/');
  });
});

describe('FilterPanel', () => {
  it('toggles a pill filter', async () => {
    const onChange = vi.fn();
    render(<FilterPanel filters={EMPTY_FILTERS} stats={stats} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remote' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, workplace: ['remote'] });
  });

  it('marks active pills as pressed and clears single-choice pills on second press', async () => {
    const onChange = vi.fn();
    render(<FilterPanel filters={{ ...EMPTY_FILTERS, minSalary: 100_000 }} stats={stats} onChange={onChange} />);
    const pill = screen.getByRole('button', { name: '$100k+' });
    expect(pill).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(pill);
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });

  it('searches and selects a country', async () => {
    const onChange = vi.fn();
    render(<FilterPanel filters={EMPTY_FILTERS} stats={stats} onChange={onChange} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search country' }), 'braz');
    expect(screen.queryByRole('radio', { name: 'United States' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Brazil' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, country: 'BR' });
  });

  it('collapses and expands sections', async () => {
    render(<FilterPanel filters={EMPTY_FILTERS} stats={stats} onChange={vi.fn()} />);
    const stack = screen.getByRole('button', { name: /^Stack/ });
    expect(stack).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(stack);
    expect(stack).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('checkbox', { name: /^TypeScript/ })).toBeInTheDocument();
  });

  it('resets filters but keeps the search text', async () => {
    const onChange = vi.fn();
    render(<FilterPanel filters={{ ...EMPTY_FILTERS, q: 'react', tier: ['S'] }} stats={stats} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, q: 'react' });
  });
});

describe('ActiveFilters', () => {
  it('renders one removable token per active value', async () => {
    const onChange = vi.fn();
    const filters = { ...EMPTY_FILTERS, workplace: ['remote' as const], country: 'BR', skills: ['Go'] };
    render(<ActiveFilters filters={filters} stats={stats} onChange={onChange} />);
    expect(screen.getAllByRole('button', { name: /^Remove filter/ }).map((b) => b.textContent)).toEqual(['Remote', 'From Brazil', 'Go']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter From Brazil' }));
    expect(onChange).toHaveBeenCalledWith({ ...filters, country: '' });
  });

  it('renders nothing without filters', () => {
    const { container } = render(<ActiveFilters filters={EMPTY_FILTERS} stats={stats} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('apply links', () => {
  it('links straight to the employer and credits the job board', () => {
    const job = makeDetail({
      source: 'remotive',
      sourceName: 'Remotive',
      url: 'https://remotive.com/remote-jobs/x-1',
      applyUrl: 'https://jobs.lever.co/acme/1',
      applyDirect: true,
      applyMethod: 'ats-discovery',
    });
    render(<JobDetailView job={job} stats={stats} variant="page" />);
    expect(screen.getByRole('link', { name: /Apply on employer site/ })).toHaveAttribute('href', 'https://jobs.lever.co/acme/1');
    expect(screen.getByText('jobs.lever.co')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Remotive' })).toHaveAttribute('href', 'https://remotive.com/remote-jobs/x-1');
  });

  it('says so when only the job board can take the application', () => {
    const job = makeDetail({
      source: 'jobicy',
      sourceName: 'Jobicy',
      url: 'https://jobicy.com/jobs/1',
      applyUrl: 'https://jobicy.com/jobs/1',
      applyDirect: false,
      applyMethod: null,
    });
    render(<JobDetailView job={job} stats={stats} variant="page" />);
    expect(screen.getByRole('link', { name: /Apply on Jobicy/ })).toHaveAttribute('href', 'https://jobicy.com/jobs/1');
    expect(screen.getByText(/couldn't verify the employer's own posting/)).toBeInTheDocument();
  });

  it('marks board-only cards with where the click goes', () => {
    render(<JobRow job={makeJob({ applyDirect: false, sourceName: 'Himalayas' })} categoryName="x" isNew={false} />);
    expect(screen.getByText('via Himalayas')).toBeInTheDocument();
  });

  it('offers an employer-posting-only filter', async () => {
    const onChange = vi.fn();
    render(<FilterPanel filters={EMPTY_FILTERS} stats={stats} onChange={onChange} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Employer's own posting only/ }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, direct: true });
  });
});

describe('freshness and "Role closed?"', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  it('says when the role was last checked', () => {
    render(<JobDetailView job={makeDetail({ lastSeenAt: hoursAgo(30), lastVerifiedAt: hoursAgo(3), checkedAt: hoursAgo(3) })} stats={stats} variant="page" />);
    expect(screen.getByText('Checked 3 hours ago')).toBeInTheDocument();
  });

  it('sends a report and thanks the visitor', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ status: 'checking' }), { status: 202, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    render(<JobDetailView job={makeDetail()} stats={stats} variant="pane" />);

    await userEvent.click(screen.getByRole('button', { name: 'Role closed?' }));
    expect(await screen.findByRole('status')).toHaveTextContent("Thanks, we're checking this role");
    expect(screen.queryByRole('button', { name: 'Role closed?' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/jobs/greenhouse%3A1/report');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('explains a rate limit, and lets the visitor retry after other failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Too many reports, please try again later.' }), { status: 429 })),
    );
    const { unmount } = render(<JobDetailView job={makeDetail()} stats={stats} variant="page" />);
    await userEvent.click(screen.getByRole('button', { name: 'Role closed?' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests, please slow down.');
    unmount();

    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
    render(<JobDetailView job={makeDetail()} stats={stats} variant="page" />);
    await userEvent.click(screen.getByRole('button', { name: 'Role closed?' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send that. Please try again later.");
    expect(screen.getByRole('button', { name: 'Role closed?' })).toBeEnabled();
  });

  it('has no report button on a closed role', () => {
    render(<JobDetailView job={makeDetail({ closedAt: hoursAgo(2) })} stats={stats} variant="page" />);
    expect(screen.queryByRole('button', { name: 'Role closed?' })).not.toBeInTheDocument();
  });
});

describe('SourcesFooter', () => {
  it('shows the audit precision when there is one', () => {
    render(<SourcesFooter sources={[]} openPrecision={0.968} />);
    expect(screen.getByText('97% of sampled roles verified open last week')).toBeInTheDocument();
  });

  it('hides it without enough verified samples', () => {
    render(<SourcesFooter sources={[]} openPrecision={null} />);
    expect(screen.queryByText(/sampled roles/)).not.toBeInTheDocument();
  });
});
