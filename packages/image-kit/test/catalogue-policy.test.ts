import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogueFamilies, familiesForScope, type CataloguePolicy } from '../src/catalogue.ts';

describe('catalogue policy', () => {
  it('groups paired KIE operations into one consumer-visible family', () => {
    const family = catalogueFamilies().find((item) => item.key === 'kie:gpt-image-2');
    assert.ok(family);
    assert.equal(family.familyName, 'GPT Image 2');
    assert.equal(family.textToImage?.id, 'gpt-image-2-text-to-image');
    assert.equal(family.imageToImage?.id, 'gpt-image-2-image-to-image');
  });

  it('keeps provider declaration order under the fixed provider order', () => {
    assert.deepEqual(
      catalogueFamilies().map((family) => family.key),
      [
        'google:gemini-nano-banana-2.1',
        'google:gemini-3.1-flash-image',
        'google:gemini-3-pro-image',
        'toapis:gemini-3.1-flash-image-preview',
        'toapis:gpt-image-2',
        'toapis:gpt-image-2.5-flare',
        'toapis:gpt-image-2.5-sunburst',
        'toapis:doubao-seedream-5-0-pro',
        'kie:grok-imagine-image-2-0',
        'kie:gpt-image-2',
        'kie:nano-banana-2',
      ],
    );
  });

  it('rejects stale exclusions and overrides instead of silently ignoring them', () => {
    const policy: CataloguePolicy = {
      overrides: { 'google:removed-model': { label: 'Removed' } },
      scopes: { test: { exclude: ['kie:removed-model'] } },
    };
    assert.throws(() => familiesForScope(policy, 'test'), /references unknown model family/);
  });

  it('adds scope exclusions to the default policy without re-inclusion', () => {
    const policy: CataloguePolicy = {
      exclude: ['kie:gpt-image-2'],
      scopes: {
        collage: { exclude: ['kie:grok-imagine-image-2-0'] },
      },
    };

    const keys = familiesForScope(policy, 'collage').map((family) => family.key);
    assert.equal(keys.includes('kie:gpt-image-2'), false);
    assert.equal(keys.includes('kie:grok-imagine-image-2-0'), false);
    assert.equal(keys.includes('kie:nano-banana-2'), true);
  });
});
