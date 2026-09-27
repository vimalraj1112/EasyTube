import { describe, expect, it } from 'vitest';

import {
  createDependencyProbes,
  runProbes,
  sourceProbe,
  type DependencyProbe,
} from '../services/health.service';
import type { DependencyCheck, ReadinessReport } from '../types/api';

const up =
  (detail = 'connected'): DependencyProbe =>
  () => ({ status: 'up', latencyMs: null, detail });
const down =
  (detail = 'refused'): DependencyProbe =>
  () => ({ status: 'down', latencyMs: null, detail });

/** Narrows a dynamic check key without a non-null assertion. */
function check(report: ReadinessReport, name: string): DependencyCheck {
  const result = report.checks[name];
  if (!result) {
    throw new Error(`expected a "${name}" check in the report`);
  }
  return result;
}

describe('runProbes', () => {
  it('reports ready when every dependency is up', async () => {
    const report = await runProbes({ database: up(), redis: up() });

    expect(report.ready).toBe(true);
    expect(check(report, 'database').status).toBe('up');
    expect(check(report, 'redis').status).toBe('up');
  });

  it('reports not ready when any dependency is down', async () => {
    const report = await runProbes({ database: up(), redis: down() });

    expect(report.ready).toBe(false);
  });

  it('keys the report by dependency name', async () => {
    const report = await runProbes({ mongodb: up(), redis: down() });

    expect(Object.keys(report.checks).sort()).toEqual(['mongodb', 'redis']);
  });

  it('converts a thrown error into a down check with the message as detail', async () => {
    const report = await runProbes({
      database: () => {
        throw new Error('pool exhausted');
      },
    });

    expect(report.ready).toBe(false);
    expect(check(report, 'database')).toMatchObject({ status: 'down', detail: 'pool exhausted' });
  });

  it('stringifies a non-Error rejection', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point of this case
    const report = await runProbes({ database: () => Promise.reject('socket hang up') });

    expect(check(report, 'database')).toMatchObject({ status: 'down', detail: 'socket hang up' });
  });

  it('awaits async probes', async () => {
    const report = await runProbes({
      database: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { status: 'up', latencyMs: null, detail: 'slow but up' };
      },
    });

    expect(report.ready).toBe(true);
  });

  it('measures elapsed latency and overwrites a reported value', async () => {
    const report = await runProbes({
      database: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { status: 'up', latencyMs: -1, detail: 'connected' };
      },
    });

    expect(check(report, 'database').latencyMs).toBeGreaterThan(0);
  });

  it('leaves latency null for a failed probe', async () => {
    const report = await runProbes({
      database: () => {
        throw new Error('down');
      },
    });

    expect(check(report, 'database').latencyMs).toBeNull();
  });

  it('runs probes concurrently rather than in series', async () => {
    const started: string[] = [];
    const slow =
      (name: string): DependencyProbe =>
      async () => {
        started.push(name);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { status: 'up', latencyMs: null, detail: name };
      };

    const report = await runProbes({ a: slow('a'), b: slow('b'), c: slow('c') });

    expect(started).toEqual(['a', 'b', 'c']);
    expect(report.ready).toBe(true);
  });

  it('treats an empty probe set as ready', async () => {
    const report = await runProbes({});

    expect(report.ready).toBe(true);
    expect(report.checks).toEqual({});
  });
});

describe('sourceProbe', () => {
  it('reads state from a connection manager', async () => {
    const report = await runProbes({
      database: sourceProbe({ isReady: () => true, describe: () => 'mongodb connected' }),
    });

    expect(check(report, 'database')).toMatchObject({ status: 'up', detail: 'mongodb connected' });
  });

  it('maps a not-ready manager to down', async () => {
    const report = await runProbes({
      database: sourceProbe({ isReady: () => false, describe: () => 'mongodb disconnected' }),
    });

    expect(check(report, 'database')).toMatchObject({
      status: 'down',
      detail: 'mongodb disconnected',
    });
  });
});

describe('createDependencyProbes', () => {
  it('exposes a probe per dependency by name', () => {
    const probes = createDependencyProbes({
      database: { isReady: () => true, describe: () => 'mongodb connected' },
      redis: { isReady: () => true, describe: () => 'redis ready' },
    });

    expect(Object.keys(probes).sort()).toEqual(['database', 'redis']);
  });

  it('produces a degraded report when a manager is down', async () => {
    const probes = createDependencyProbes({
      database: { isReady: () => true, describe: () => 'mongodb connected' },
      redis: { isReady: () => false, describe: () => 'redis wait' },
    });

    const report = await runProbes(probes);

    expect(report.ready).toBe(false);
    expect(check(report, 'database').status).toBe('up');
    expect(check(report, 'redis').status).toBe('down');
  });
});
