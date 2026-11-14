import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto.js';

const DESCRIPTIONS: Record<number, string> = {
  400: 'The request is malformed or failed validation. `message` lists the invalid fields.',
  401: 'The access token is missing, invalid or expired.',
  403: 'The caller is authenticated but not allowed: not an active member of the house, or the action needs the admin role.',
  404: 'The target resource does not exist in this house.',
  409: 'The request conflicts with the current state (for example a concurrent change or a business precondition). See `code`.',
  410: 'The resource existed but is no longer available.',
  413: 'The uploaded file is too large.',
  415: 'The uploaded file type is not supported.',
  422: 'The request is well-formed but violates a business rule. See `code`.',
  429: 'Rate limit or daily quota exceeded.',
  503: 'An upstream service (AI, storage) is temporarily unavailable.',
};

const NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

/** Example body for one status, so the page never shows a 409 example under a 400 response. */
function exampleFor(status: number) {
  const base = { statusCode: status, error: NAMES[status] ?? 'Error' };
  if (status === 400) return { ...base, message: ['title must be longer than or equal to 1 characters'] };
  if (status === 401) return { ...base, message: 'Unauthorized' };
  return { ...base, message: 'Localized explanation for the user.', code: 'ERROR_CODE' };
}

/**
 * Documents error responses with the shared `ErrorResponseDto`. Pass a status, or `[status, description]`
 * when the endpoint needs a more specific explanation than the default for that status.
 */
export function ApiErrors(...errors: (number | [status: number, description: string])[]) {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ...errors.map((e) => {
      const [status, description] = typeof e === 'number' ? [e, DESCRIPTIONS[e] ?? 'Error.'] : e;
      return ApiResponse({
        status,
        description,
        schema: { allOf: [{ $ref: getSchemaPath(ErrorResponseDto) }], example: exampleFor(status) },
      });
    }),
  );
}
