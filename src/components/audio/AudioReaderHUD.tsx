import React from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { CompassPill } from './CompassPill';
import { SatelliteFAB } from './SatelliteFAB';

export const AudioReaderHUD: React.FC = () => {
  const queue = useTTSStore(state => state.queue);

  // Visibility Logic: Only show if there is audio queued.
  if (!queue || queue.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-6 left-0 right-0 z-40 flex justify-center pointer-events-none px-4">
      <div className="relative w-full max-w-sm">
        {/* The Compass Pill - Centered */}
        <div className="flex justify-center">
            <CompassPill />
        </div>

        {/* The Satellite FAB - Floating to the right, slightly overlapping/above */}
        <div className="absolute -right-2 -top-8 md:-right-16 md:top-auto md:bottom-2">
           <SatelliteFAB />
        </div>
      </div>
    </div>
  );
};
