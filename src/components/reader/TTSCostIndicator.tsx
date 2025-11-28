import React, { useEffect, useState } from 'react';
import { useCostStore } from '../../lib/tts/CostEstimator';
import { useTTSStore } from '../../store/useTTSStore';
import { CircleDollarSign } from 'lucide-react';

export const TTSCostIndicator: React.FC = () => {
  const sessionCharacters = useCostStore((state) => state.sessionCharacters);
  const { provider } = useTTSStore();
  const [estimatedCost, setEstimatedCost] = useState(0);

  useEffect(() => {
    // Rough estimate calculation
    // $0.000016 per char (Google) or similar
    const cost = sessionCharacters * 0.000016;
    setEstimatedCost(cost);
  }, [sessionCharacters]);

  if (sessionCharacters === 0 || provider === 'local') {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-1 rounded-full bg-secondary/50" title="Estimated session cost">
      <CircleDollarSign size={14} />
      <span>
        {sessionCharacters.toLocaleString()} chars (~${estimatedCost.toFixed(4)})
      </span>
    </div>
  );
};
