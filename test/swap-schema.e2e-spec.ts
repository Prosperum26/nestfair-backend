import { randomUUID } from 'node:crypto';
import { createFixture } from './support/house-fixture.js';

describe('Swap schema constraints (e2e)', () => {
  let fx: Awaited<ReturnType<typeof createFixture>>;
  const houseId = randomUUID();
  const lockIds: string[] = [];

  beforeAll(async () => {
    fx = await createFixture('@e2e-swap-schema.nestfair.test');
  });
  afterAll(async () => {
    await fx.prisma.choreSwapRequest.deleteMany({ where: { houseId } });
    await fx.prisma.choreDebt.deleteMany({ where: { houseId } });
    await fx.prisma.swapLock.deleteMany({ where: { assignmentId: { in: lockIds } } });
    await fx.cleanup();
  });

  const base = () => {
    const id = randomUUID();
    return {
      id,
      houseId,
      requesterMemberId: randomUUID(),
      rootRequestId: id,
      expiresAt: new Date(Date.now() + 3_600_000),
      fromWeightSnapshot: 2,
    };
  };

  const exchange = () => ({
    ...base(),
    type: 'EXCHANGE' as const,
    fromAssignmentId: randomUUID(),
    toAssignmentId: randomUUID(),
    targetMemberId: randomUUID(),
  });
  const cover = () => ({
    ...base(),
    type: 'COVER' as const,
    fromAssignmentId: randomUUID(),
    compensation: 'PAYBACK' as const,
  });

  it('accepts well-formed EXCHANGE, COVER and PERMANENT rows', async () => {
    await expect(fx.prisma.choreSwapRequest.create({ data: exchange() })).resolves.toBeTruthy();
    await expect(fx.prisma.choreSwapRequest.create({ data: cover() })).resolves.toBeTruthy();
    await expect(
      fx.prisma.choreSwapRequest.create({ data: { ...base(), type: 'PERMANENT', targetMemberId: randomUUID() } }),
    ).resolves.toBeTruthy();
  });

  it('rejects EXCHANGE without toAssignmentId', async () => {
    const { toAssignmentId: _omit, ...data } = exchange();
    await expect(fx.prisma.choreSwapRequest.create({ data })).rejects.toThrow();
  });

  it('rejects COVER without compensation', async () => {
    const { compensation: _omit, ...data } = cover();
    await expect(fx.prisma.choreSwapRequest.create({ data })).rejects.toThrow();
  });

  it('rejects PERMANENT with fromAssignmentId', async () => {
    await expect(
      fx.prisma.choreSwapRequest.create({
        data: { ...base(), type: 'PERMANENT', fromAssignmentId: randomUUID() },
      }),
    ).rejects.toThrow();
  });

  it.each([999, 500001])('rejects rewardAmount %i', async (rewardAmount) => {
    await expect(
      fx.prisma.choreSwapRequest.create({ data: { ...cover(), compensation: 'GIFT', rewardAmount } }),
    ).rejects.toThrow();
  });

  it('rejects rewardAmount when compensation is PAYBACK', async () => {
    await expect(
      fx.prisma.choreSwapRequest.create({ data: { ...cover(), rewardAmount: 30000 } }),
    ).rejects.toThrow();
  });

  it('accepts GIFT with rewardAmount in range', async () => {
    await expect(
      fx.prisma.choreSwapRequest.create({ data: { ...cover(), compensation: 'GIFT', rewardAmount: 30000 } }),
    ).resolves.toBeTruthy();
  });

  it('rejects a request addressed to the requester', async () => {
    const data = exchange();
    await expect(
      fx.prisma.choreSwapRequest.create({ data: { ...data, targetMemberId: data.requesterMemberId } }),
    ).rejects.toThrow();
  });

  it('rejects ChoreDebt.weight = 0', async () => {
    await expect(
      fx.prisma.choreDebt.create({
        data: {
          houseId,
          debtorMemberId: randomUUID(),
          creditorMemberId: randomUUID(),
          swapRequestId: randomUUID(),
          coverAssignmentId: randomUUID(),
          weight: 0,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a second SwapLock for the same assignment', async () => {
    const assignmentId = randomUUID();
    lockIds.push(assignmentId);
    await fx.prisma.swapLock.create({ data: { assignmentId, swapRequestId: randomUUID() } });
    await expect(
      fx.prisma.swapLock.create({ data: { assignmentId, swapRequestId: randomUUID() } }),
    ).rejects.toThrow();
  });
});
