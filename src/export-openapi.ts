/**
 * Writes the OpenAPI document to docs/openapi.json (git-ignored) so it can be handed in or imported into
 * Postman / Redocly without running the server by hand.
 *
 *   npm run docs:export   (builds first: tsx does not emit the decorator metadata Nest needs)
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { buildOpenApiDocument } from './swagger.setup.js';

const app = await NestFactory.create(AppModule, { logger: ['error'] });
configureApp(app);
await app.init();
mkdirSync('docs', { recursive: true });
writeFileSync('docs/openapi.json', JSON.stringify(buildOpenApiDocument(app), null, 2));
await app.close();
console.log('Wrote docs/openapi.json');
