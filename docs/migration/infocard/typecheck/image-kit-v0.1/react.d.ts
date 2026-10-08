import type { FC } from "react";

export function useImageModels(): { models: unknown[] };
export function findImageModel(
  models: unknown[],
  id: string,
): { label: string } | undefined;
export const ErrorPanel: FC;
