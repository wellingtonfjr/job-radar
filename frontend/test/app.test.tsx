import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { makeDetail, makeJob, stats } from './fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const jobs = [makeJob(), makeJob({ id: 'lever:2', title: 'Product Designer', category: 'design', companyTier: null })];

describe('App', () => {
  let requests: string[];

  beforeEach(() => {
    requests = [];
    window.history.replaceState(null, '', '/');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url.startsWith('/api/stats')) return jsonResponse(stats);
        if (url.startsWith('/api/jobs/greenhouse%3A1')) return jsonResponse(makeDetail());
        if (url.startsWith('/api/jobs/missing')) return jsonResponse({ error: 'Job not found' }, 404);
        if (url.startsWith('/api/jobs')) {
          const q = new URL(url, 'http://x').searchParams;
          const filtered = q.get('category') ? jobs.filter((j) => j.category === q.get('category')) : jobs;
          return jsonResponse({ jobs: filtered, total: filtered.length, page: 1, pageSize: 20, hasMore: false });
        }
        return jsonResponse({ error: 'Not found' }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists jobs, filters by category chip and keeps the filter in the URL', async () => {
    render(<App />);
    expect(await screen.findByText('Senior Frontend Engineer')).toBeInTheDocument();
    expect(screen.getByText('Product Designer')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Design' }));
    expect(await screen.findByText(/1/, { selector: '.results__count' })).toBeInTheDocument();
    expect(screen.queryByText('Senior Frontend Engineer')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?category=design');
    expect(requests.some((r) => r.includes('category=design'))).toBe(true);
  });

  it('opens a job detail page and goes back', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Senior Frontend Engineer' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Senior Frontend Engineer' })).toBeInTheDocument();
    expect(screen.getByText('We build things.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Apply on company site/ })).toHaveAttribute('href', 'https://example.com/jobs/1');

    await userEvent.click(screen.getByRole('link', { name: 'All jobs' }));
    expect(await screen.findByText('Product Designer')).toBeInTheDocument();
  });

  it('shows a friendly message for jobs that no longer exist', async () => {
    window.history.replaceState(null, '', '/jobs/missing');
    render(<App />);
    expect(await screen.findByText('This job is no longer listed')).toBeInTheDocument();
  });

  it('shows an error with retry when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    // A query no earlier test loaded, so the back-navigation cache can't serve it.
    window.history.replaceState(null, '', '/?q=offline');
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the job-radar API");
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
