// Stand-in for InfoCard's src/contexts/LanguageContext.tsx (unchanged).
import type { ReactNode } from 'react';

export function LanguageProvider(props: { children?: ReactNode }): ReactNode {
  return props.children ?? null;
}
