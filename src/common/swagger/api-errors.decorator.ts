import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
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

/**
 * Documents error responses with the shared `ErrorResponseDto`. Pass a status, or `[status, description]`
 * when the endpoint needs a more specific explanation than the default for that status.
 */
export function ApiErrors(...errors: (number | [status: number, description: string])[]) {
  return applyDecorators(
    ...errors.map((e) => {
      const [status, description] = typeof e === 'number' ? [e, DESCRIPTIONS[e] ?? 'Error.'] : e;
      return ApiResponse({ status, description, type: ErrorResponseDto });
    }),
  );
}
