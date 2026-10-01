import { useCallback, useEffect, useState } from 'react';
import { fetchImageModels } from '../services/imageApi';
import { reportError } from '../services/errorReporter';
import type { ImageModelView } from '../shared/imageModels';

interface ImageModelsState {
  models: ImageModelView[];
  loading: boolean;
  /** True after a failed load; reload() tries again. */
  failed: boolean;
}

/** One shared request per page load. A failed load is reported to the ErrorPanel and can be retried. */
let pending: Promise<ImageModelView[]> | null = null;

export function useImageModels(): ImageModelsState & { reload: () => void } {
  const [state, setState] = useState<ImageModelsState>({ models: [], loading: true, failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    pending ??= fetchImageModels();
    pending.then(
      (models) => {
        if (active) setState({ models, loading: false, failed: false });
      },
      (error: unknown) => {
        pending = null;
        reportError(error, 'image-models');
        if (active) setState({ models: [], loading: false, failed: true });
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const reload = useCallback(() => {
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    setAttempt((value) => value + 1);
  }, []);
  return { ...state, reload };
}

export function findImageModel(models: readonly ImageModelView[], id: string): ImageModelView | undefined {
  return models.find((model) => model.id === id);
}
