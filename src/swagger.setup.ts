import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ERROR_CODES } from './common/swagger/error-codes.js';

/** Tags in display order, each with the explanation shown above its operations. */
export const API_TAGS: readonly (readonly [name: string, description: string])[] = [
  ['health', 'Liveness probe used by the hosting platform. No authentication.'],
  ['auth', 'Account registration, email and password sign-in, Google sign-in, access-token refresh with a rotating refresh cookie, and sign-out.'],
  ['users', 'The signed-in user: profile, avatar, bank account used for QR payments, password, notification preferences and the consents required before data is sent to the AI provider.'],
  ['houses', 'Creating a house, joining with an invite code, house details, rules, invite code management and the member list.'],
  ['membership', 'Member lifecycle inside a house: leaving, removing a member, transferring the admin role and dissolving the house.'],
  ['rule-proposals', 'Members propose additions, edits or removals of the house rules; the admin approves or rejects them.'],
  ['chores', 'Chore definitions, the weekly rotating schedule (fair rotation with a 3-week repeat fence), shuffling the week and system chores.'],
  ['chore-settings', 'House-level chore settings: the grace period for late photo submissions and the maximum number of assignments one person can get per day.'],
  ['assignments', 'A single scheduled chore occurrence: listing, photo check-in, peer verification, admin override and dispute handling.'],
  ['absences', 'Member absences, whole-house breaks and the chore audit log. The scheduler skips absent members.'],
  ['swaps', 'Chore swap requests: exchange two assignments, ask someone to cover (with a payback or a gift), the cover market, expiry and escalation, and permanent rotation swaps.'],
  ['chore-debts', 'Chore debts created when a member covers someone else for a payback: listing the debts, choosing the payback assignment and forgiving a debt.'],
  ['wheel', 'Lucky Wheel for ad-hoc chores. The server picks the winner; clients only animate the result from a seed.'],
  ['activity', 'Live ticker of recent house activity.'],
  ['expenses', 'Shared expenses with EQUAL, CUSTOM, EXACT or ITEMIZED splits, monthly ledger, summary and net balances. Amounts are integer VND.'],
  ['settlements', 'Paying back debts: simplified debt plan (minimum cash flow), VietQR payment data, transfer reports and confirmation by the receiver.'],
  ['receipts', 'Receipt OCR with Gemini Vision. The result is only a draft; nothing is saved to the ledger until the user confirms an expense.'],
  ['assistant', 'Private AI housemate assistant. Suggested actions are buttons only; the AI never writes data by itself.'],
  ['reminders', 'Personal reminders created by the user, by the system or from an assistant suggestion.'],
  ['listings', 'Roommate-finding listing of a house: edit, photos, publish, close, poster data.'],
  ['public-listings', 'Public, unauthenticated view of a published listing by slug. Exposes no email, bank number or member names.'],
];

const errorTable = Object.entries(ERROR_CODES)
  .map(([code, [status, meaning]]) => `| \`${code}\` | ${status} | ${meaning} |`)
  .join('\n');

const OVERVIEW = `
NestFair is a shared-housing management API for students: chores with fair rotation, expense splitting with
minimum-cash-flow settlement, an AI housemate assistant, receipt OCR and roommate-finding listings.

## Conventions

- **Base path:** every route is under \`/api/v1\`. Bodies and responses are JSON unless a route says \`multipart/form-data\`.
- **Money** is an integer number of Vietnamese dong (VND). There are no decimals anywhere.
- **Dates:** calendar days are \`YYYY-MM-DD\` in Vietnam time (UTC+7); instants are ISO 8601 UTC strings.
- **Identifiers** are UUIDs. A house-scoped route is \`/houses/{houseId}/...\`; the server checks that the caller is an
  active member of that house and never trusts a house id sent in a body.
- **Roles** inside a house: \`ADMIN\` (house admin) and \`ROOMMATE\`. Routes that need the admin say so.
- **Members never get hard-deleted:** leaving or removal sets \`leftAt\`; history stays visible.
- **Validation:** unknown properties are rejected with 400.

## Authentication

1. \`POST /auth/register\` or \`POST /auth/login\` returns a short-lived **access token** (15 minutes) in the body and sets
   an httpOnly **refresh cookie** \`nf_rt\` (7 days, rotated on every use).
2. Send the access token as \`Authorization: Bearer <token>\` on every protected route. In this page press **Authorize**
   and paste the token.
3. When the access token expires, call \`POST /auth/refresh\` (the cookie is sent automatically) to get a new pair.
4. Google sign-in is available only when the server has Google credentials configured.

## Errors

Every error uses the same body: \`{ statusCode, message, error, code? }\`.
\`message\` is **localized Vietnamese text for the web UI**; clients must branch on the stable English \`code\`, never on \`message\`.
Validation failures (400) return \`message\` as an array of field messages and no \`code\`.
Some errors carry extra fields documented on the operation (for example \`membersWithBalance\`, \`retryAfterMs\`, \`resetAt\`).

| Status | Meaning |
| :--- | :--- |
| 400 | Malformed request or failed validation |
| 401 | Missing, invalid or expired access token |
| 403 | Authenticated but not allowed (not a member of the house, wrong role, not the owner) |
| 404 | Resource not found in this house |
| 409 | Conflict with current state (concurrent change, precondition not met) |
| 410 | Gone (for example an expired swap request) |
| 413 / 415 | Uploaded image too large / unsupported type (JPEG, PNG or WebP up to 5 MB) |
| 422 | Valid request that breaks a business rule |
| 429 | Rate limit or daily quota exceeded |
| 503 | AI or storage provider temporarily unavailable |

### Rate limits and quotas

A global throttle of 20 requests per minute per client applies to most routes (the public listing route allows 60).
Business quotas: assistant chat 30 messages per user per day, receipt scans 20 per house per day, swap requests 3 pending
and 10 per day per member, wheel spins limited per hour and per day per house.

### Error code catalogue

| Code | Status | Meaning |
| :--- | :--- | :--- |
${errorTable}

## Realtime (Socket.IO)

REST is the only way to change data. Socket.IO (same host, path \`/socket.io\`) only broadcasts. Authenticate the socket
with the access token, then emit \`house:join_room\` with a house id (the server checks membership and acknowledges with
the list of online user ids). Clients join two kinds of room: \`house:<houseId>\` and \`user:<userId>\`.
Each event is an envelope \`{ eventId, type, houseId, occurredAt, actor, payload }\` emitted only after the database
transaction commits. After a reconnect, clients should refetch their data.

| Event | Emitted when |
| :--- | :--- |
| \`member:joined\`, \`member:left\`, \`member:role_changed\`, \`presence:update\` | Membership changes or online presence changes |
| \`house:dissolved\` | The admin dissolved the house (sent to each member) |
| \`chore:submitted\`, \`chore:verified\`, \`chore:missed\`, \`chore:reassigned\`, \`chore:cancelled\`, \`chore:shuffled\` | Assignment lifecycle and schedule changes |
| \`swap:requested\`, \`swap:accepted\`, \`swap:rejected\`, \`swap:cancelled\`, \`swap:expired\`, \`swap:escalated\`, \`rotation_swap:applied\` | Swap request lifecycle |
| \`chore_debt:created\`, \`chore_debt:paid\`, \`chore_debt:forgiven\`, \`chore_debt:pick_requested\` | Chore debt lifecycle |
| \`wheel:spinning\`, \`wheel:result\`, \`wheel:voided\` | Lucky Wheel spin lifecycle |
| \`expense:new\`, \`expense:updated\`, \`expense:deleted\` | Ledger changes |
| \`settlement:requested\`, \`settlement:cancelled\`, \`debt:settled\` | Payment reports and confirmations |
| \`rule_proposal:created\`, \`rule_proposal:decided\` | House rule proposals |
| \`listing:closed\`, \`listing:reopened\` | Roommate listing status changes |
| \`reminder:due\` | A personal reminder fired (sent to that user only) |
| \`activity:new\` | A new entry in the live ticker |
| \`session:expired\` | The socket's access token expired |
`;

/** Builds the OpenAPI document served at /api/docs and exported by `npm run docs:export`. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('NestFair API')
    .setVersion('0.1.0')
    .setDescription(OVERVIEW)
    .setContact('NestFair team (UIT, MSIS207)', 'https://github.com/Prosperum26', '')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token from POST /auth/login or /auth/register.' })
    .addCookieAuth('nf_rt', { type: 'apiKey', in: 'cookie', name: 'nf_rt', description: 'httpOnly refresh cookie set by the server; used only by POST /auth/refresh and /auth/logout.' });
  const publicUrl = process.env.PUBLIC_API_URL?.trim();
  if (publicUrl) builder.addServer(publicUrl, 'Deployed API');
  builder.addServer('http://localhost:5000', 'Local development');
  for (const [name, description] of API_TAGS) builder.addTag(name, description);
  return SwaggerModule.createDocument(app, builder.build());
}

/** Mounts Swagger UI at /api/docs (JSON at /api/docs-json). */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app), {
    customSiteTitle: 'NestFair API documentation',
    swaggerOptions: {
      persistAuthorization: true,
      withCredentials: true,
      docExpansion: 'none',
      displayRequestDuration: true,
      operationsSorter: 'alpha',
    },
  });
}
