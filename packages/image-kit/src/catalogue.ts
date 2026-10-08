import { GOOGLE_IMAGE_MODELS, type ImageModelInfo } from '@hk01/pi-ai-extra-google';
import { KIE_IMAGE_MODELS } from '@hk01/pi-ai-extra-kie';
import { TOAPIS_IMAGE_MODELS } from '@hk01/pi-ai-extra-toapis';
import type { ImageProvider, MaskEditing, PriceEstimate } from './models.ts';

/** Stable consumer identity for one provider-owned model family. */
export type CanonicalModelKey = `${ImageProvider}:${string}`;

/** App-owned presentation policy; provider capabilities remain in the catalogue. */
export interface CatalogueModelOverride {
  label?: string;
  description?: string;
  maskEditing?: MaskEditing;
  price?: PriceEstimate | null;
}

/** Additive app or tool policy applied to provider catalogue families. */
export interface CatalogueScopePolicy {
  /** Provider family keys this app or tool permanently cannot support. */
  exclude?: readonly CanonicalModelKey[];
  overrides?: Readonly<Record<CanonicalModelKey, CatalogueModelOverride>>;
}

/** The consumer's default policy plus route-owned tool overlays. */
export interface CataloguePolicy extends CatalogueScopePolicy {
  scopes: Readonly<Record<string, CatalogueScopePolicy>>;
}

/** One consumer-visible family, with operations selected from reference-image presence. */
export interface CatalogueModelFamily {
  key: CanonicalModelKey;
  provider: ImageProvider;
  familyId: string;
  familyName: string;
  unified?: ImageModelInfo;
  textToImage?: ImageModelInfo;
  imageToImage?: ImageModelInfo;
}

export const PROVIDER_ORDER: readonly ImageProvider[] = ['google', 'toapis', 'kie'];

const CATALOGUES: Record<ImageProvider, readonly ImageModelInfo[]> = {
  google: GOOGLE_IMAGE_MODELS,
  toapis: TOAPIS_IMAGE_MODELS,
  kie: KIE_IMAGE_MODELS,
};

export function canonicalModelKey(provider: ImageProvider, familyId: string): CanonicalModelKey {
  return `${provider}:${familyId}`;
}

/** Groups provider-declared operations into selector-ready model families. */
export function catalogueFamilies(): readonly CatalogueModelFamily[] {
  const families = new Map<CanonicalModelKey, CatalogueModelFamily>();

  for (const provider of PROVIDER_ORDER) {
    for (const info of CATALOGUES[provider]) {
      const key = canonicalModelKey(provider, info.familyId);
      const family = families.get(key) ?? {
        key,
        provider,
        familyId: info.familyId,
        familyName: info.familyName,
      };
      if (family.familyName !== info.familyName) {
        throw new Error(`image-kit: ${key} has conflicting family names`);
      }
      if (info.operationRole === 'unified') {
        if (family.unified) throw new Error(`image-kit: ${key} has multiple unified operations`);
        family.unified = info;
      } else if (info.operationRole === 'text-to-image') {
        if (family.textToImage) throw new Error(`image-kit: ${key} has multiple text-to-image operations`);
        family.textToImage = info;
      } else {
        if (family.imageToImage) throw new Error(`image-kit: ${key} has multiple image-to-image operations`);
        family.imageToImage = info;
      }
      families.set(key, family);
    }
  }

  for (const family of families.values()) {
    if (family.unified && (family.textToImage || family.imageToImage)) {
      throw new Error(`image-kit: ${family.key} mixes unified and split operations`);
    }
    if (!family.unified && (!family.textToImage || !family.imageToImage)) {
      throw new Error(`image-kit: ${family.key} must declare both text-to-image and image-to-image operations`);
    }
  }
  return [...families.values()];
}

function scopePolicy(policy: CataloguePolicy, scope: string): CatalogueScopePolicy {
  const selected = policy.scopes[scope];
  if (!selected) throw new Error(`image-kit: unknown model scope "${scope}"`);
  return selected;
}

/** Families offered by one route-owned scope, in deterministic provider/catalogue order. */
export function familiesForScope(policy: CataloguePolicy, scope: string): readonly CatalogueModelFamily[] {
  const overlay = scopePolicy(policy, scope);
  const excluded = new Set([...(policy.exclude ?? []), ...(overlay.exclude ?? [])]);
  const known = new Set(catalogueFamilies().map((family) => family.key));
  for (const key of [...excluded, ...Object.keys(policy.overrides ?? {}), ...Object.keys(overlay.overrides ?? {})]) {
    if (!known.has(key as CanonicalModelKey)) throw new Error(`image-kit: ${scope} references unknown model family "${key}"`);
  }
  return catalogueFamilies().filter((family) => !excluded.has(family.key));
}

/** Scope overrides win per field, while exclusions remain additive-only. */
export function overrideForScope(policy: CataloguePolicy, scope: string, key: CanonicalModelKey): CatalogueModelOverride {
  return { ...(policy.overrides?.[key] ?? {}), ...(scopePolicy(policy, scope).overrides?.[key] ?? {}) };
}

/** Chooses one provider operation without exposing text/edit implementation details to consumers. */
export function operationForRequest(family: CatalogueModelFamily, referenceCount: number): ImageModelInfo {
  const operation = family.unified ?? (referenceCount === 0 ? family.textToImage : family.imageToImage);
  if (!operation) throw new Error(`image-kit: ${family.key} has no operation for this request`);
  return operation;
}

/** Uses documented notes when an app has not provided its own description. */
export function descriptionForFamily(family: CatalogueModelFamily): string {
  const operation = family.unified ?? family.imageToImage ?? family.textToImage;
  const notes = operation?.notes.join(' ') ?? '';
  return notes || family.familyName;
}
