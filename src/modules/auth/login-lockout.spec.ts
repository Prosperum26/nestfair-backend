import { HttpException } from '@nestjs/common';
import { LOCKOUT, LoginLockout } from './login-lockout.js';

const MIN = 60_000;

function lockedError(fn: () => void): HttpException {
  try {
    fn();
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('không ném lỗi');
}

describe('LoginLockout', () => {
  it(`chưa khóa khi sai dưới ${LOCKOUT.maxFailures} lần`, () => {
    const l = new LoginLockout();
    for (let i = 0; i < LOCKOUT.maxFailures - 1; i++) l.recordFailure('a@x.vn', 0);
    expect(() => l.assertNotLocked('a@x.vn', 0)).not.toThrow();
  });

  it(`sai ${LOCKOUT.maxFailures} lần thì khóa 15 phút, trả 429 LOGIN_LOCKED kèm retryAfterSeconds`, () => {
    const l = new LoginLockout();
    for (let i = 0; i < LOCKOUT.maxFailures; i++) l.recordFailure('a@x.vn', 0);
    const err = lockedError(() => l.assertNotLocked('a@x.vn', 5 * MIN));
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse()).toMatchObject({ code: 'LOGIN_LOCKED', retryAfterSeconds: 10 * 60 });
    expect(() => l.assertNotLocked('a@x.vn', 15 * MIN)).not.toThrow();
  });

  it('hết khóa thì đếm lại từ đầu', () => {
    const l = new LoginLockout();
    for (let i = 0; i < LOCKOUT.maxFailures; i++) l.recordFailure('a@x.vn', 0);
    l.recordFailure('a@x.vn', 16 * MIN);
    expect(() => l.assertNotLocked('a@x.vn', 16 * MIN)).not.toThrow();
  });

  it('các lần sai cách nhau quá cửa sổ 15 phút không cộng dồn', () => {
    const l = new LoginLockout();
    for (let i = 0; i < LOCKOUT.maxFailures; i++) l.recordFailure('a@x.vn', i * 16 * MIN);
    expect(() => l.assertNotLocked('a@x.vn', 4 * 16 * MIN)).not.toThrow();
  });

  it('đăng nhập đúng thì xóa bộ đếm', () => {
    const l = new LoginLockout();
    for (let i = 0; i < LOCKOUT.maxFailures - 1; i++) l.recordFailure('a@x.vn', 0);
    l.reset('a@x.vn');
    l.recordFailure('a@x.vn', 0);
    expect(() => l.assertNotLocked('a@x.vn', 0)).not.toThrow();
  });

  it('khóa theo từng email, không ảnh hưởng tài khoản khác', () => {
    const l = new LoginLockout();
    for (let i = 0; i < LOCKOUT.maxFailures; i++) l.recordFailure('a@x.vn', 0);
    expect(() => l.assertNotLocked('b@x.vn', 0)).not.toThrow();
  });

  it('giới hạn số email theo dõi để không tràn bộ nhớ khi bị dò hàng loạt', () => {
    const l = new LoginLockout(3);
    for (const e of ['1@x', '2@x', '3@x', '4@x']) l.recordFailure(e, 0);
    expect(l.size).toBeLessThanOrEqual(3);
  });
});

describe('LoginLockout.recordFailure', () => {
  it('trả true đúng lần làm khóa tài khoản (để ghi log bảo mật)', () => {
    const l = new LoginLockout();
    const results = Array.from({ length: LOCKOUT.maxFailures }, () => l.recordFailure('a@x.vn', 0));
    expect(results).toEqual([...Array(LOCKOUT.maxFailures - 1).fill(false), true]);
  });
});
