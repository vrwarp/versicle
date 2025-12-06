import React from 'react';
import { CompassPill } from './CompassPill';
import { SatelliteFAB } from './SatelliteFAB';

interface ChapterCompassProps {
  onPrev: () => void;
  onNext: () => void;
}

export const ChapterCompass: React.FC<ChapterCompassProps> = ({ onPrev, onNext }) => {
  return (
    <div data-testid="chapter-compass" className="absolute bottom-6 left-0 right-0 px-6 md:px-8 pointer-events-none z-40 flex items-end justify-between md:justify-center">

      {/* Centered Compass Pill (Pointer events re-enabled) */}
      <div className="pointer-events-auto mx-auto md:absolute md:bottom-0 md:left-1/2 md:-translate-x-1/2 md:translate-y-0 pb-1">
        <CompassPill onPrev={onPrev} onNext={onNext} />
      </div>

      {/* Satellite FAB (Right aligned) */}
      <div className="pointer-events-auto md:absolute md:right-8 md:bottom-0 pb-1">
        <SatelliteFAB />
      </div>
    </div>
  );
};
