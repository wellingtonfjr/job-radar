import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { JobDetailView } from '../src/components/JobDetailView';
import { JobRow } from '../src/components/JobRow';
import { makeDetail, makeJob, stats } from './fixtures';

const STORAGE_KEY = 'job-radar:roleMarks';

function stored(): Record<string, { savedAt: string | null; appliedAt: string | null; title: string }> {
  return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('saving and applied marks', () => {
  it('saves and unsaves a role from its row without opening it', async () => {
    const onSelect = vi.fn();
    render(<JobRow job={makeJob()} categoryName="x" isNew={false} onSelect={onSelect} />);
    const save = screen.getByRole('button', { name: 'Save Senior Frontend Engineer' });
    expect(save).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(save);
    expect(save).toHaveAttribute('aria-pressed', 'true');
    expect(stored()['greenhouse:1']).toMatchObject({ title: 'Senior Frontend Engineer', appliedAt: null });
    expect(onSelect).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');

    await userEvent.click(save);
    expect(save).toHaveAttribute('aria-pressed', 'false');
    expect(stored()).toEqual({});
  });

  it('dims applied roles and badges them instead of "New"', async () => {
    render(<JobRow job={makeJob()} categoryName="x" isNew />);
    expect(screen.getByText('New')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mark Senior Frontend Engineer as applied' }));
    expect(screen.getByRole('article')).toHaveClass('job-card--applied');
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.queryByText('New')).not.toBeInTheDocument();
    expect(stored()['greenhouse:1']?.appliedAt).toEqual(expect.any(String));
  });

  it('keeps the detail toggles and the list row in sync', async () => {
    render(
      <>
        <JobRow job={makeJob()} categoryName="x" isNew={false} />
        <JobDetailView job={makeDetail()} stats={stats} variant="pane" />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('button', { name: 'Save Senior Frontend Engineer' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Applied' }));
    expect(screen.getByRole('button', { name: 'Mark Senior Frontend Engineer as applied' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('picks up changes made in another tab', () => {
    render(<JobRow job={makeJob()} categoryName="x" isNew={false} />);
    act(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ 'greenhouse:1': { id: 'greenhouse:1', title: 'x', company: 'y', companyLogo: null, savedAt: '2026-10-20T00:00:00Z', appliedAt: null } }),
      );
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });
    expect(screen.getByRole('button', { name: 'Save Senior Frontend Engineer' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('still works, without persistence, when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    render(<JobRow job={makeJob({ id: 'lever:9' })} categoryName="x" isNew={false} />);
    const save = screen.getByRole('button', { name: 'Save Senior Frontend Engineer' });
    await userEvent.click(save);
    expect(save).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Saved view', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.startsWith('/api/stats')
          ? stats
          : { jobs: [makeJob()], total: 1, newLast7Days: 0, page: 1, pageSize: 20, hasMore: false };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
  });

  it('shows an empty state with nothing saved', async () => {
    window.history.replaceState(null, '', '/saved');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Saved roles' })).toBeInTheDocument();
    expect(screen.getByText('No saved roles yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Saved roles (0)' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Live')).toBeInTheDocument();
  });

  it('lists saved roles newest first from their snapshot, including closed ones', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'ashby:old': { id: 'ashby:old', title: 'Closed Role', company: 'Gone Inc', companyLogo: null, savedAt: '2026-10-01T00:00:00Z', appliedAt: '2026-10-02T00:00:00Z' },
        'ashby:new': { id: 'ashby:new', title: 'Fresh Role', company: 'Newco', companyLogo: null, savedAt: '2026-10-20T00:00:00Z', appliedAt: null },
        'ashby:applied-only': { id: 'ashby:applied-only', title: 'Not Saved', company: 'X', companyLogo: null, savedAt: null, appliedAt: '2026-10-20T00:00:00Z' },
      }),
    );
    render(<App />);
    await userEvent.click(screen.getByRole('link', { name: 'Saved roles (2)' }));
    expect(window.location.pathname).toBe('/saved');

    const links = screen.getAllByRole('link').filter((a) => a.classList.contains('job-card__link'));
    expect(links.map((a) => a.textContent)).toEqual(['Fresh Role', 'Closed Role']);
    expect(links[1]).toHaveAttribute('href', '/jobs/ashby%3Aold');
    expect(screen.queryByText('Not Saved')).not.toBeInTheDocument();
    expect(screen.getByText('Applied')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save Fresh Role' }));
    expect(screen.queryByText('Fresh Role')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Saved roles (1)' })).toBeInTheDocument();
  });
});
