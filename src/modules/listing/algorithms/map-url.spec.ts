import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isGoogleMapsUrl, MAP_URL_MAX } from './map-url.js';

describe('isGoogleMapsUrl', () => {
  it('nhận link Google Maps https: đầy đủ, rút gọn, tọa độ, tên miền .vn', () => {
    for (const ok of [
      'https://www.google.com/maps/place/UIT/@10.870,106.803,17z',
      'https://google.com/maps?q=10.870,106.803',
      'https://www.google.com/maps/search/?api=1&query=10.87,106.803',
      'https://maps.google.com/?q=10.870,106.803',
      'https://maps.app.goo.gl/AbCdEf123',
      'https://goo.gl/maps/AbCdEf123',
      'https://www.google.com.vn/maps/place/UIT',
      'https://WWW.GOOGLE.COM/maps/place/UIT',
    ]) {
      expect(isGoogleMapsUrl(ok), ok).toBe(true);
    }
  });

  it('từ chối link không phải https hoặc không phải Google Maps', () => {
    for (const bad of [
      'http://www.google.com/maps/place/UIT',
      'javascript:alert(1)',
      'https://www.google.com/search?q=uit',
      'https://google.com.evil.com/maps',
      'https://evil.com/www.google.com/maps',
      'https://www.google.com.evil.com/maps',
      'https://maps.google.com.evil.com/',
      'https://goo.gl/AbCdEf',
      'https://user:pass@www.google.com/maps',
      'https://www.google.com:8443/maps',
      'https://bing.com/maps',
      'www.google.com/maps',
      '',
      'not a url',
    ]) {
      expect(isGoogleMapsUrl(bad), bad).toBe(false);
    }
  });

  it('giới hạn độ dài 500 ký tự', () => {
    expect(MAP_URL_MAX).toBe(500);
    const long = 'https://www.google.com/maps?q=' + 'a'.repeat(MAP_URL_MAX);
    expect(isGoogleMapsUrl(long)).toBe(false);
  });
});

/** Bảng vector dùng chung với frontend (src/features/listing/map-url.vectors.json): hai bên phải trả cùng kết quả. */
describe('isGoogleMapsUrl theo bảng vector dùng chung', () => {
  const vectors = JSON.parse(readFileSync(new URL('./map-url.vectors.json', import.meta.url), 'utf8')) as {
    valid: string[];
    invalid: string[];
  };
  const expand = (v: string) => v.replace('{LONG}', 'a'.repeat(MAP_URL_MAX));

  it.each(vectors.valid)('nhận %s', (v) => {
    expect(isGoogleMapsUrl(expand(v))).toBe(true);
  });

  it.each(vectors.invalid)('từ chối %s', (v) => {
    expect(isGoogleMapsUrl(expand(v))).toBe(false);
  });
});
