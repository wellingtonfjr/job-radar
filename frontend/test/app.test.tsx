import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { makeDetail, makeJob, stats } from './fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const jobs = [makeJob(), makeJob({ id: 'lever:2', title: 'Product Designer', category: 'design', companyTier: null })];

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('App', () => {
  let requests: string[];

  beforeEach(() => {
    requests = [];
    window.history.replaceState(null, '', '/');
    stubMatchMedia(false);
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
          // The filtered count (0) differs from the site-wide one in stats (1).
          const newLast7Days = q.get('category') ? 0 : 1;
          return jsonResponse({ jobs: filtered, total: filtered.length, newLast7Days, page: 1, pageSize: 20, hasMore: false });
        }
        return jsonResponse({ error: 'Not found' }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists roles, filters from the sidebar and keeps filters in the URL', async () => {
    render(<App />);
    expect(await screen.findByText('Senior Frontend Engineer')).toBeInTheDocument();
    expect(screen.getByText('Product Designer')).toBeInTheDocument();

    const sidebar = screen.getByRole('complementary', { name: 'Filters' });
    await userEvent.click(await within(sidebar).findByRole('checkbox', { name: /Design/ }));
    expect(await screen.findByRole('button', { name: 'Remove filter Design' })).toBeInTheDocument();
    expect(screen.queryByText('Senior Frontend Engineer')).not.toBeInTheDocument();
    expect(window.location.search).toBe('?category=design');
    expect(requests.some((r) => r.includes('category=design'))).toBe(true);
  });

  it('links the RSS feed for the current search', async () => {
    window.history.replaceState(null, '', '/?q=react&workplace=remote&direct=true');
    render(<App />);
    const feedLink = await screen.findByRole('link', { name: 'Subscribe to this search (RSS feed)' });
    expect(feedLink).toHaveAttribute('href', '/api/jobs/feed.xml?q=react&workplace=remote&direct=true');
    expect(document.head.querySelector('link[rel="alternate"][type="application/rss+xml"]')).toHaveAttribute(
      'href',
      '/api/jobs/feed.xml?q=react&workplace=remote&direct=true',
    );

    const sidebar = screen.getByRole('complementary', { name: 'Filters' });
    await userEvent.click(await within(sidebar).findByRole('checkbox', { name: /Design/ }));
    expect(feedLink).toHaveAttribute('href', '/api/jobs/feed.xml?q=react&category=design&workplace=remote&direct=true');
    expect(document.head.querySelectorAll('link[rel="alternate"]')).toHaveLength(1);
  });

  it('counts new roles within the filters in the header', async () => {
    render(<App />);
    const summary = await screen.findByText(/verified open/);
    expect(summary).toHaveTextContent('2 verified open · 1 new this week');

    const sidebar = screen.getByRole('complementary', { name: 'Filters' });
    await userEvent.click(await within(sidebar).findByRole('checkbox', { name: /Design/ }));
    expect(await screen.findByText(/matching/)).toHaveTextContent('1 matching · 0 new this week');
  });

  it('opens the full detail page on narrow screens and goes back', async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Senior Frontend Engineer' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Senior Frontend Engineer' })).toBeInTheDocument();
    expect(screen.getByText('We build things.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Apply on employer site/ })).toHaveAttribute('href', 'https://example.com/jobs/1');

    await userEvent.click(screen.getByRole('link', { name: /All roles/ }));
    expect(await screen.findByText('Product Designer')).toBeInTheDocument();
  });

  it('opens a preview beside the list on wide screens only once a role is picked', async () => {
    stubMatchMedia(true);
    window.history.replaceState(null, '', '/?q=split');
    render(<App />);
    await userEvent.click(await screen.findByRole('link', { name: 'Senior Frontend Engineer' }));
    const preview = screen.getByRole('complementary', { name: 'Role preview' });
    expect(await within(preview).findByRole('heading', { level: 2, name: 'Senior Frontend Engineer' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(new URLSearchParams(window.location.search).get('job')).toBe('greenhouse:1');

    await userEvent.click(within(preview).getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('complementary', { name: 'Role preview' })).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('job')).toBeNull();
  });

  it('gives the list the full width on wide screens until a role is picked', async () => {
    stubMatchMedia(true);
    window.history.replaceState(null, '', '/?q=wide');
    render(<App />);
    expect(await screen.findByText('Senior Frontend Engineer')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Role preview' })).not.toBeInTheDocument();
  });

  it('shows a friendly message for roles that no longer exist', async () => {
    window.history.replaceState(null, '', '/jobs/missing');
    render(<App />);
    expect(await screen.findByText('This role is no longer listed')).toBeInTheDocument();
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
