import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  estimateImageCostUsd,
  modelIssue,
  ratioValue,
  referenceIssue,
  remainingReferenceCapacity,
  resolutionIssue,
  selectedModelIssue,
  temperatureFor,
  type ImageModelView,
} from '../src/models.ts';

function view(overrides: Partial<ImageModelView> = {}): ImageModelView {
  return {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    description: '',
    provider: 'google',
    providerLabel: 'Google Gemini',
    providerModel: 'gemini-3.1-flash-image',
    acceptedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    referenceLimit: { min: 0, max: 14 },
    temperature: { min: 0, max: 2 },
    resolutions: ['1K', '2K', '4K'],
    maskEditing: 'supported',
    price: { perImageUsd: { '1K': 0.067, '2K': 0.101 }, inputPerMillionTokensUsd: 0.5 },
    available: true,
    unavailableReason: null,
    ...overrides,
  };
}

describe('ratioValue', () => {
  it('parses W:H and WxH presets', () => {
    assert.equal(ratioValue('16:9'), 16 / 9);
    assert.equal(ratioValue('300x250'), 1.2);
    assert.equal(ratioValue(' 4 : 5 '), 0.8);
    assert.equal(ratioValue('1200:675'), 1200 / 675);
  });

  it('rejects anything else', () => {
    for (const value of ['original', '', '4:', '0:5', '5:0', '-1:2']) assert.equal(ratioValue(value), undefined, value);
  });
});

describe('model issues', () => {
  it('reports reference counts outside the limit', () => {
    assert.equal(referenceIssue(view(), 14), null);
    assert.equal(referenceIssue(view(), 15), '最多 14 張參考圖，已選 15 張');
    assert.equal(referenceIssue(view({ referenceLimit: { min: 1, max: 5 } }), 0), '至少需要 1 張參考圖，已選 0 張');
    assert.equal(referenceIssue(view({ referenceLimit: { min: 0, max: null } }), 99), null);
  });

  it('treats only 4K as a strict resolution', () => {
    const grok = view({ resolutions: [] });
    assert.equal(resolutionIssue(grok, '4K'), '不支援 4K');
    assert.equal(resolutionIssue(grok, '2K'), null);
    assert.equal(resolutionIssue(grok, undefined), null);
    assert.equal(resolutionIssue(view(), '4K'), null);
  });

  it('puts a missing key first, then references, then resolution', () => {
    const missing = view({ available: false, unavailableReason: '伺服器未設定 KIE_API_KEY' });
    assert.equal(modelIssue(missing, { referenceCount: 99, resolution: '4K' }), '伺服器未設定 KIE_API_KEY');
    assert.equal(modelIssue(view({ resolutions: [] }), { referenceCount: 20, resolution: '4K' }), '最多 14 張參考圖，已選 20 張');
    assert.equal(modelIssue(view({ resolutions: [] }), { referenceCount: 1, resolution: '4K' }), '不支援 4K');
    assert.equal(modelIssue(view(), { referenceCount: 1 }), null);
  });

  it('treats a model list that has not loaded as an issue', () => {
    assert.equal(selectedModelIssue(undefined, { referenceCount: 0 }), '圖片模型清單尚未載入');
    assert.equal(selectedModelIssue(view(), { referenceCount: 20 }), '最多 14 張參考圖，已選 20 張');
    assert.equal(selectedModelIssue(view(), { referenceCount: 1 }), null);
  });

  it('counts remaining reference capacity', () => {
    assert.equal(remainingReferenceCapacity(view(), 10), 4);
    assert.equal(remainingReferenceCapacity(view(), 20), 0);
    assert.equal(remainingReferenceCapacity(view({ referenceLimit: { min: 0, max: null } }), 20), Number.POSITIVE_INFINITY);
  });
});

describe('temperatureFor', () => {
  it('sends temperature only to models that accept it', () => {
    assert.equal(temperatureFor(view(), 0.7), 0.7);
    assert.equal(temperatureFor(view({ temperature: null }), 0.7), undefined);
    assert.equal(temperatureFor(undefined, 0.7), undefined);
  });
});

describe('estimateImageCostUsd', () => {
  it('adds input tokens to the per-image price', () => {
    const cost = estimateImageCostUsd(view(), { resolution: '1K', inputImages: 2, promptChars: 4000 });
    assert.ok(cost !== null);
    assert.ok(Math.abs(cost - (0.067 + (1516 / 1_000_000) * 0.5)) < 1e-12);
  });

  it('is unknown without a price for the resolution', () => {
    assert.equal(estimateImageCostUsd(view(), { resolution: '4K', inputImages: 0, promptChars: 0 }), null);
    assert.equal(estimateImageCostUsd(view({ price: null }), { resolution: '1K', inputImages: 0, promptChars: 0 }), null);
    assert.equal(estimateImageCostUsd(undefined, { resolution: '1K', inputImages: 0, promptChars: 0 }), null);
  });
});
