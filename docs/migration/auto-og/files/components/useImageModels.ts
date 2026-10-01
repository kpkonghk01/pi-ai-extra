import { useEffect, useState } from 'react';
import { fetchImageModels } from '../services/imageApi';
import { reportError } from '../services/errorReporter';
import type { ImageModelView } from '../shared/imageModels';

interface ImageModelsState {
  models: ImageModelView[];
  loading: boolean;
}

/** One shared request per page load; a failed load is reported and retried on the next mount. */
let pending: Promise<ImageModelView[]> | null = null;

export function useImageModels(): ImageModelsState {
  const [state, setState] = useState<ImageModelsState>({ models: [], loading: true });
  useEffect(() => {
    let active = true;
    pending ??= fetchImageModels();
    pending.then(
      (models) => {
        if (active) setState({ models, loading: false });
      },
      (error: unknown) => {
        pending = null;
        reportError(error, 'image-models');
        if (active) setState({ models: [], loading: false });
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return state;
}

export function findImageModel(models: readonly ImageModelView[], id: string): ImageModelView | undefined {
  return models.find((model) => model.id === id);
}
