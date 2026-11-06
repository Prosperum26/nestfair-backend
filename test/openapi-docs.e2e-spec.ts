import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { OpenAPIObject } from '@nestjs/swagger';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureApp } from './../src/app.setup.js';
import { ERROR_CODES } from './../src/common/swagger/error-codes.js';
import { SWAP_ERRORS } from './../src/modules/swaps/swap-errors.js';
import { API_TAGS, buildOpenApiDocument, setupSwagger } from './../src/swagger.setup.js';

/**
 * Audit of the generated OpenAPI document (the page the lecturer reads). It encodes "done" for the API docs:
 * English only, every operation and schema property explained, errors documented.
 */

const VIETNAMESE = /[À-ỹ]/;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type Operation = {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: { name: string; in: string; description?: string }[];
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }>;
  security?: unknown[];
};

describe('OpenAPI document (docs audit)', () => {
  let app: INestApplication<App>;
  let doc: OpenAPIObject;
  const ops: { id: string; tag: string; path: string; op: Operation }[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    setupSwagger(app);
    await app.init();
    doc = buildOpenApiDocument(app);
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const m of METHODS) {
        const op = (item as Record<string, Operation | undefined>)[m];
        if (op) ops.push({ id: `${m.toUpperCase()} ${path}`, tag: op.tags?.[0] ?? 'untagged', path, op });
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const report = (offenders: string[]) => offenders.slice(0, 40).join('\n') + (offenders.length > 40 ? `\n… and ${offenders.length - 40} more` : '');

  it('has no Vietnamese text anywhere in the document', () => {
    const offenders: string[] = [];
    const walk = (value: unknown, where: string) => {
      if (typeof value === 'string') {
        if (VIETNAMESE.test(value)) offenders.push(`${where}: ${value.slice(0, 70)}`);
      } else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${where}[${i}]`));
      else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`);
    };
    for (const o of ops) walk(o.op, o.id);
    for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) walk(schema, `schema ${name}`);
    walk(doc.info, 'info');
    expect(report(offenders)).toBe('');
  });

  it('gives every operation a summary and a description of at least 80 characters', () => {
    const offenders = ops
      .filter(({ op }) => !op.summary?.trim() || (op.description?.trim().length ?? 0) < 80)
      .map((o) => o.id);
    expect(report(offenders)).toBe('');
  });

  it('gives every operation a documented success response with a schema (or 204 / redirect)', () => {
    const offenders = ops
      .filter(({ op }) => {
        const ok = Object.entries(op.responses ?? {}).filter(([code]) => /^[23]/.test(code));
        return ok.length === 0 || !ok.some(([code, r]) => code === '204' || code.startsWith('3') || r.content?.['application/json']?.schema || r.content?.['image/png']);
      })
      .map((o) => o.id);
    expect(report(offenders)).toBe('');
  });

  it('documents 401 and 403 on every house-scoped operation', () => {
    const offenders = ops
      .filter(({ path }) => path.includes('/houses/{houseId}/'))
      .filter(({ op }) => !op.responses?.['401'] || !op.responses?.['403'] || !op.security?.length)
      .map((o) => o.id);
    expect(report(offenders)).toBe('');
  });

  it('only references security schemes that the document declares', () => {
    const schemes = new Set(Object.keys(doc.components?.securitySchemes ?? {}));
    const offenders = ops.flatMap(({ id, op }) =>
      (op.security ?? []).flatMap((req) => Object.keys(req as Record<string, unknown>)).filter((name) => !schemes.has(name)).map((name) => `${id}: ${name}`),
    );
    expect(report(offenders)).toBe('');
  });

  it('describes every path and query parameter', () => {
    const offenders = ops.flatMap(({ id, op }) =>
      (op.parameters ?? []).filter((p) => !p.description?.trim()).map((p) => `${id} (${p.in}) ${p.name}`),
    );
    expect(report(offenders)).toBe('');
  });

  it('describes every schema property', () => {
    const offenders: string[] = [];
    for (const [name, schema] of Object.entries(doc.components?.schemas ?? {})) {
      const props = (schema as { properties?: Record<string, { description?: string; $ref?: string; allOf?: unknown[] }> }).properties ?? {};
      for (const [prop, def] of Object.entries(props)) if (!def.description?.trim()) offenders.push(`${name}.${prop}`);
    }
    expect(report(offenders)).toBe('');
  });

  it('explains authentication, errors, conventions and realtime in the overview', () => {
    const text = doc.info.description ?? '';
    for (const heading of ['## Conventions', '## Authentication', '## Errors', '## Realtime']) expect(text).toContain(heading);
    expect(doc.servers?.length).toBeGreaterThan(0);
    expect(VIETNAMESE.test(text)).toBe(false);
  });

  it('describes every tag in use and keeps API_TAGS in sync with the controllers', () => {
    const described = new Set((doc.tags ?? []).filter((t) => t.description?.trim()).map((t) => t.name));
    const used = new Set(ops.map((o) => o.tag));
    expect([...used].filter((t) => !described.has(t))).toEqual([]);
    expect(API_TAGS.map(([n]) => n).filter((n) => !used.has(n))).toEqual([]);
  });

  it('lists every error code the source can throw in the catalogue', () => {
    const found = new Set<string>(Object.keys(SWAP_ERRORS));
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('spec.ts') && !p.includes('generated')) {
          const src = readFileSync(p, 'utf8');
          for (const m of src.matchAll(/coded\(\s*HttpStatus\.[A-Z_]+\s*,\s*'([A-Z][A-Z_0-9]+)'/g)) found.add(m[1]);
          if (p.endsWith('assistant.service.ts')) for (const m of src.matchAll(/code: '([A-Z][A-Z_0-9]+)'/g)) found.add(m[1]);
        }
      }
    };
    walk('src');
    expect([...found].filter((c) => !(c in ERROR_CODES)).sort()).toEqual([]);
    const overview = doc.info.description ?? '';
    expect(Object.keys(ERROR_CODES).filter((c) => !overview.includes(`\`${c}\``))).toEqual([]);
  });

  it('serves the UI and the JSON document', async () => {
    await request(app.getHttpServer()).get('/api/docs').expect(200);
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(Object.keys((res.body as OpenAPIObject).paths).length).toBe(Object.keys(doc.paths).length);
  });
});
