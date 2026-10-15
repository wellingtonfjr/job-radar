import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActiveFilters } from '../src/components/ActiveFilters';
import { FilterPanel } from '../src/components/FilterPanel';
import { JobRow } from '../src/components/JobRow';
import { EMPTY_FILTERS } from '../src/lib/filters';
import { makeJob, stats } from './fixtures';

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
