import React, { useState } from 'react';
import { HelpCircle, Sparkles, Sliders, ShieldCheck, Zap } from 'lucide-react';

interface TemperatureControlProps {
  temperature: number;
  onChange: (value: number) => void;
  compact?: boolean;
  /** Shown instead of enabling the control when the selected model does not accept temperature. */
  disabledReason?: string | null;
}

export const TemperatureControl: React.FC<TemperatureControlProps> = ({
  temperature,
  onChange,
  compact = false,
  disabledReason = null,
}) => {
  const disabled = disabledReason !== null;
  const [showTooltip, setShowTooltip] = useState(false);

  // Quick preset values
  const PRESETS = [
    { value: 0.2, label: '忠實', tag: '0.2 低發散', desc: '還原結構，少幻覺', icon: ShieldCheck, color: 'text-blue-600 bg-blue-50 border-blue-200' },
    { value: 0.7, label: '平衡', tag: '0.7 推薦', desc: '標準美化與高畫質', icon: Sparkles, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    { value: 1.2, label: '創意', tag: '1.2 高發散', desc: '豐富視覺與藝術感', icon: Zap, color: 'text-purple-600 bg-purple-50 border-purple-200' },
  ];

  const getActivePreset = () => {
    if (temperature <= 0.35) return '忠實';
    if (temperature >= 0.95) return '創意';
    return '平衡';
  };

  const activeLabel = getActivePreset();

  return (
    <div className={`bg-gray-50/70 border border-gray-200 rounded-2xl ${compact ? 'p-3 space-y-2' : 'p-4 space-y-3'} transition-all`} aria-disabled={disabled}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders size={compact ? 14 : 16} className="text-sky-600" />
          <span className="font-extrabold text-xs text-gray-800 flex items-center gap-1.5">
            AI忠實程度: <span className="text-sky-600 font-mono font-bold">{temperature.toFixed(2)}</span>
            <span className="text-[10px] font-extrabold text-sky-700 bg-sky-100/80 px-2 py-0.5 rounded-full border border-sky-200">
              {activeLabel}
            </span>
          </span>
        </div>

        {/* What does this mean? Button with hover tooltip */}
        <div className="relative inline-block">
          <button
            type="button"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={() => setShowTooltip(!showTooltip)}
            className="flex items-center gap-1 text-[11px] font-bold text-sky-700 hover:text-sky-900 bg-white hover:bg-sky-50 px-2.5 py-1 rounded-full border border-sky-200 shadow-xs transition-all cursor-pointer"
          >
            <HelpCircle size={13} className="text-sky-600" />
            <span>這是什麼意思？</span>
          </button>

          {/* Mouseover Explanation Card */}
          {showTooltip && (
            <div
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-white border border-sky-200 rounded-2xl shadow-xl p-4 z-50 text-xs text-gray-700 space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="flex items-center justify-between border-b border-sky-100 pb-2">
                <span className="font-extrabold text-sky-950 flex items-center gap-1.5">
                  <Sliders size={14} className="text-sky-600" />
                  AI 忠實程度 (Temperature) 解釋
                </span>
                <span className="text-[10px] text-gray-400 font-mono">0.1 ~ 1.5</span>
              </div>

              <p className="text-[11px] text-gray-600 leading-relaxed">
                控制 AI 繪圖發散程度與創意隨機性。數值越低越忠於原始素材，數值越高越具視覺美感與發散變化。
              </p>

              <div className="space-y-2 pt-1">
                <div className="p-2 rounded-xl bg-blue-50/60 border border-blue-100 flex items-start gap-2">
                  <ShieldCheck size={15} className="text-blue-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-blue-950 text-[11px]">忠實 (0.1 - 0.4)</div>
                    <div className="text-[10px] text-blue-800 leading-snug">
                      嚴格遵循風格樣板與新聞原圖細節，構圖最穩定、少變形，還原度高。
                    </div>
                  </div>
                </div>

                <div className="p-2 rounded-xl bg-emerald-50/60 border border-emerald-100 flex items-start gap-2">
                  <Sparkles size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-emerald-950 text-[11px]">平衡 (0.5 - 0.8) 【預設推薦】</div>
                    <div className="text-[10px] text-emerald-800 leading-snug">
                      在素材還原與適度畫風美化之間取得最佳平衡，品質與細節最穩定。
                    </div>
                  </div>
                </div>

                <div className="p-2 rounded-xl bg-purple-50/60 border border-purple-100 flex items-start gap-2">
                  <Zap size={15} className="text-purple-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-purple-950 text-[11px]">創意 (0.9 - 1.5)</div>
                    <div className="text-[10px] text-purple-800 leading-snug">
                      給予 AI 更多藝術發揮空間，畫面燈光、色調與細節豐富，適合海報創作。
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {disabled && (
        <p role="note" className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          {disabledReason}（已保留目前設定，切回支援的模型時會沿用）
        </p>
      )}

      {/* Range Slider (the value is kept while disabled) */}
      <fieldset disabled={disabled} className={`space-y-1.5 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
        <input
          type="range"
          min="0.1"
          max="1.5"
          step="0.05"
          value={temperature}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-400"
        />

        {/* Presets Grid (Left: 忠實, Middle: 平衡, Right: 創意) */}
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          {PRESETS.map((p) => {
            const isCurrentPreset = Math.abs(temperature - p.value) < 0.15;
            const Icon = p.icon;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange(p.value)}
                className={`flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all cursor-pointer ${
                  isCurrentPreset
                    ? 'bg-sky-600 text-white border-sky-600 shadow-xs font-bold scale-[1.02]'
                    : 'bg-white text-gray-700 border-gray-200 hover:bg-sky-50/80 hover:border-sky-300'
                }`}
              >
                <div className="flex items-center gap-1 font-black text-xs">
                  <Icon size={12} className={isCurrentPreset ? 'text-white' : p.color.split(' ')[0]} />
                  <span>{p.label}</span>
                </div>
                <span className={`text-[10px] mt-0.5 font-mono ${isCurrentPreset ? 'text-sky-100' : 'text-gray-400'}`}>
                  {p.value.toFixed(1)}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
};
