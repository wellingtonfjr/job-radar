import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobDetailView } from '../src/components/JobDetailView';
import { RoleMarkButtons } from '../src/components/RoleMarkButtons';
import * as analytics from '../src/lib/analytics';
import { EMPTY_FILTERS } from '../src/lib/filters';
import { makeDetail, stats } from './fixtures';

vi.mock('../src/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof analytics>()),
  track: vi.fn(),
}));

const track = vi.mocked(analytics.track);

beforeEach(() => {
  track.mockClear();
  localStorage.clear();
});

describe('analytics helpers', () => {
  it('is off in tests, and never loads the SDK', () => {
    expect(analytics.analyticsEnabled()).toBe(false);
  });

  it('strips the search text from our own URLs only', () => {
    const origin = 'https://radar-de-vagas.fly.dev';
    expect(analytics.stripSearchText(`${origin}/?q=jane%20doe&category=dev`, origin)).toBe(`${origin}/?category=dev`);
    expect(analytics.stripSearchText(`${origin}/jobs/x`, origin)).toBe(`${origin}/jobs/x`);
    expect(analytics.stripSearchText('https://example.com/?q=keep', origin)).toBe('https://example.com/?q=keep');
    expect(analytics.stripSearchText('not a url', origin)).toBe('not a url');
  });

  it('describes a search by its filters, never its text', () => {
    const props = analytics.searchProps({ ...EMPTY_FILTERS, q: ' react ', seniority: ['senior'], country: 'BR', direct: true }, 0);
    expect(props).toMatchObject({ has_search: true, search_length: 5, filter_count: 3, seniority: ['senior'], country: 'BR', direct_only: true, results: 0 });
    expect(Object.values(props)).not.toContain('react');
  });
});

describe('tracked actions', () => {
  it('records a role view once and each click on Apply', async () => {
    const job = makeDetail();
    const { rerender } = render(<JobDetailView job={job} stats={stats} variant="pane" />);
    rerender(<JobDetailView job={job} stats={stats} variant="pane" />);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('job_viewed', expect.objectContaining({ job_id: job.id, source: job.source, view: 'pane', closed: false }));

    // Clicking a target=_blank link in jsdom doesn't navigate.
    await userEvent.click(screen.getByRole('link', { name: /Apply/ }));
    expect(track).toHaveBeenLastCalledWith('apply_clicked', expect.objectContaining({ job_id: job.id, view: 'pane' }));
  });

  it('records saving and un-saving a role', async () => {
    render(<RoleMarkButtons role={makeDetail()} variant="full" />);
    const save = screen.getByRole('button', { name: /Save/ });
    await userEvent.click(save);
    await userEvent.click(save);
    expect(track.mock.calls).toEqual([
      ['role_marked', { mark: 'saved', on: true, view: 'full' }],
      ['role_marked', { mark: 'saved', on: false, view: 'full' }],
    ]);
  });
});
