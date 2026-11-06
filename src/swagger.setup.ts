import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Builds the OpenAPI document served at /api/docs and exported by `npm run docs:export`. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('NestFair API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addCookieAuth('nf_rt')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Mounts Swagger UI at /api/docs (JSON at /api/docs-json). */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app), {
    swaggerOptions: { persistAuthorization: true, withCredentials: true },
  });
}
