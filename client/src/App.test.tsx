import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { api } from '@/lib/api';
import { ApiClientError } from '@/lib/apiClient';
import type { HealthData } from '@/types/api';

const HEALTH: HealthData = {
  status: 'ok',
  service: 'easytube-api',
  version: '0.1.0',
  environment: 'test',
  uptimeSeconds: 125,
  timestamp: '2026-01-01T00:00:00.000Z',
};

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
}

describe('App shell', () => {
  it('renders the EasyTube brand', async () => {
    vi.spyOn(api, 'health').mockResolvedValue(HEALTH);

    renderApp();

    expect(await screen.findAllByText(/EasyTube/)).not.toHaveLength(0);
    expect(screen.getByRole('link', { name: /easytube home/i })).toBeInTheDocument();
  });

  it('shows "API Connected" when the health endpoint responds', async () => {
    vi.spyOn(api, 'health').mockResolvedValue(HEALTH);

    renderApp();

    expect(await screen.findByText('API Connected')).toBeInTheDocument();
  });

  it('renders live health metadata returned by the API', async () => {
    vi.spyOn(api, 'health').mockResolvedValue(HEALTH);

    renderApp();

    await screen.findByText('API Connected');
    await waitFor(() => {
      expect(screen.getByText('v0.1.0')).toBeInTheDocument();
    });
    expect(screen.getByText(/^test$/i)).toBeInTheDocument();
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
  });

  it('shows an unreachable state when the health request fails', async () => {
    vi.spyOn(api, 'health').mockRejectedValue(
      new ApiClientError({ kind: 'network', message: 'Connection lost.', code: 'NETWORK_ERROR' }),
    );

    renderApp();

    expect(await screen.findByText('API Unreachable')).toBeInTheDocument();
  });

  it('renders the legal notice in the footer', async () => {
    vi.spyOn(api, 'health').mockResolvedValue(HEALTH);

    renderApp();

    const notice = await screen.findByText(
      'Only download content you own or have permission to download.',
      { selector: 'footer p' },
    );
    expect(notice).toBeInTheDocument();
  });

  it('renders a not-found page for unknown routes', async () => {
    vi.spyOn(api, 'health').mockResolvedValue(HEALTH);

    render(
      <MemoryRouter initialEntries={['/nope']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });
});
