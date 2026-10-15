import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar } from '../src/components/FilterBar';
import { JobRow } from '../src/components/JobRow';
import { EMPTY_FILTERS } from '../src/lib/filters';
import { makeJob, stats } from './fixtures';

describe('JobRow', () => {
  it('links to the detail page and shows the normalized facts', () => {
    render(<JobRow job={makeJob()} categoryName="Software Development" isNew={false} />);
    expect(screen.getByRole('link', { name: 'Senior Frontend Engineer' })).toHaveAttribute('href', '/jobs/greenhouse%3A1');
    const tags = within(screen.getByRole('list', { name: 'Job details' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(tags).toEqual(['Software Development', 'Full-time', 'Senior', '$150K – $180K', 'Worldwide', 'TypeScript', 'React']);
    expect(screen.getByText('Tier S')).toBeInTheDocument();
  });

  it('shows the work mode for non-remote jobs and a New badge', () => {
    render(<JobRow job={makeJob({ workplace: 'hybrid', locations: ['Berlin'], allowedCountries: ['DE'], companyTier: null })} categoryName="x" isNew />);
    expect(screen.getByText('Hybrid')).toBeInTheDocument();
    expect(screen.getByText('Berlin')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.queryByText(/Tier/)).not.toBeInTheDocument();
  });
});

describe('FilterBar', () => {
  it('toggles a multi-select option', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={EMPTY_FILTERS} stats={stats} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Work mode/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Remote' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, workplace: ['remote'] });
  });

  it('closes on Escape and returns focus to the chip', async () => {
    render(<FilterBar filters={EMPTY_FILTERS} stats={stats} onChange={vi.fn()} />);
    const chip = screen.getByRole('button', { name: /Category/ });
    await userEvent.click(chip);
    expect(screen.getByRole('dialog', { name: 'Category filter' })).toBeInTheDocument();
    // Categories with no open jobs are hidden.
    expect(screen.queryByRole('checkbox', { name: 'All Others' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(chip).toHaveFocus();
  });

  it('filters countries by search and selects one', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={EMPTY_FILTERS} stats={stats} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Your location/ }));
    await userEvent.type(screen.getByRole('searchbox', { name: /Search where you can work from/i }), 'braz');
    expect(screen.queryByRole('radio', { name: 'United States' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Brazil' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, country: 'BR' });
  });

  it('offers to clear active filters but keeps the search text', async () => {
    const onChange = vi.fn();
    render(<FilterBar filters={{ ...EMPTY_FILTERS, q: 'react', tier: ['S'], country: 'BR' }} stats={stats} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters (2)' }));
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, q: 'react' });
  });
});
