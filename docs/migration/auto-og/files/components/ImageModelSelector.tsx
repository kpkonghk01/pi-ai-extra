import React from 'react';
import { modelIssue, PROVIDER_ORDER, type ImageModelView } from '../shared/imageModels';

interface ImageModelSelectorProps {
  models: readonly ImageModelView[];
  value: string;
  onChange: (id: string) => void;
  /** Reference images the next request will send; options that cannot take them are disabled. */
  referenceCount: number;
  loading?: boolean;
  className?: string;
}

/**
 * Image model picker grouped by provider (Google, KIE, ToAPIs). Models without a server key or
 * with a lower reference-image limit stay visible but disabled, with the reason in the label.
 */
export const ImageModelSelector: React.FC<ImageModelSelectorProps> = ({ models, value, onChange, referenceCount, loading, className }) => {
  if (loading && models.length === 0) {
    return (
      <select disabled className={className} value="">
        <option value="">載入模型中…</option>
      </select>
    );
  }
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={className} title="圖片生成模型">
      {PROVIDER_ORDER.map((provider) => {
        const group = models.filter((model) => model.provider === provider);
        if (group.length === 0) return null;
        return (
          <optgroup key={provider} label={group[0]?.providerLabel ?? provider}>
            {group.map((model) => {
              const issue = modelIssue(model, referenceCount);
              return (
                <option key={model.id} value={model.id} disabled={issue !== null && model.id !== value}>
                  {issue ? `${model.label}（${issue}）` : model.label}
                </option>
              );
            })}
          </optgroup>
        );
      })}
    </select>
  );
};

interface ImageModelIssueProps {
  model: ImageModelView | undefined;
  referenceCount: number;
  className?: string;
}

/** Red hint shown near the Generate button when the selected model cannot run as configured. */
export const ImageModelIssue: React.FC<ImageModelIssueProps> = ({ model, referenceCount, className }) => {
  if (!model) return null;
  const issue = modelIssue(model, referenceCount);
  if (!issue) return null;
  const fix = model.available ? '請移除部分圖片，或改選其他模型。' : '請改選其他模型，或請管理員設定金鑰。';
  return (
    <p role="status" className={className ?? 'mt-2 text-xs font-semibold text-red-600'}>
      目前模型「{model.label}」{issue}。{fix}
    </p>
  );
};
