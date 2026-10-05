import React from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/Button';
import { GeneratedImage } from '../store';
import { format } from 'date-fns';
import { findImageModel, useImageModels } from '@hk01/pi-ai-extra-image-kit/react';
import { formatCost, sumCosts } from '../lib/pricing';

interface TokenHistoryProps {
  history: GeneratedImage[];
  onClose: () => void;
}

export function TokenHistory({ history, onClose }: TokenHistoryProps) {
  const currentMonth = new Date().getMonth();
  const { models } = useImageModels();
  // Removed models (for example OpenRouter) have no entry any more; their id is shown instead.
  const modelLabel = (id: string) => findImageModel(models, id)?.label ?? id;
  
  const monthlyCost = sumCosts(history
    .filter(h => new Date(h.timestamp).getMonth() === currentMonth)
    .map(h => h.costHKD));

  const dailyCosts = history.reduce((acc, curr) => {
    const date = format(curr.timestamp, 'yyyy-MM-dd');
    return { ...acc, [date]: [...(acc[date] ?? []), curr.costHKD] };
  }, {} as Record<string, number[]>);
  const dailyStats = Object.fromEntries(Object.entries(dailyCosts).map(([date, costs]) => [date, sumCosts(costs)]));

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-200">
          <h2 className="text-xl font-bold">費用與 Token 紀錄</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        
        <div className="p-6 overflow-y-auto space-y-8">
          <div className="bg-zinc-50 p-6 rounded-xl border border-zinc-200 text-center">
            <h3 className="text-sm font-medium text-zinc-500 mb-2">本月累計費用</h3>
            <p className="text-4xl font-bold text-zinc-900">HK$ {monthlyCost.totalHKD.toFixed(2)}</p>
            {monthlyCost.unpriced > 0 && (
              <p className="text-xs text-zinc-500 mt-2">另有 {monthlyCost.unpriced} 張未計價（該模型沒有查證過的單價）</p>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4">每日統計</h3>
            <div className="space-y-2">
              {Object.entries(dailyStats).sort((a, b) => b[0].localeCompare(a[0])).map(([date, cost]) => (
                <div key={date} className="flex justify-between items-center p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                  <span className="font-medium">{date}</span>
                  <span className="text-zinc-600">
                    HK$ {cost.totalHKD.toFixed(2)}
                    {cost.unpriced > 0 && <span className="text-zinc-400">（{cost.unpriced} 張未計價）</span>}
                  </span>
                </div>
              ))}
              {Object.keys(dailyStats).length === 0 && (
                <p className="text-zinc-500 text-center py-4">暫無紀錄</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-4">詳細流水帳</h3>
            <div className="space-y-2">
              {history.map(item => (
                <div key={item.id} className="flex justify-between items-center p-3 bg-zinc-50 rounded-lg border border-zinc-100 text-sm">
                  <div>
                    <p className="font-medium">{format(item.timestamp, 'yyyy-MM-dd HH:mm:ss')}</p>
                    <p className="text-zinc-500 text-xs mt-1">
                      模型: {modelLabel(item.model)} | 比例: {item.ratio}
                    </p>
                  </div>
                  <span className="font-semibold text-zinc-700">{formatCost(item.costHKD)}</span>
                </div>
              ))}
              {history.length === 0 && (
                <p className="text-zinc-500 text-center py-4">暫無紀錄</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
