import React from 'react';
import { useUIStore } from '../store/useUIStore';
import { Sheet } from './ui/Sheet';
import { UnifiedAudioPanel } from './reader/UnifiedAudioPanel';

// Wrapper component to use hooks inside App
export const AudioPanelWrapper: React.FC = () => {
    const { isAudioPanelOpen, setAudioPanelOpen } = useUIStore();
    return (
      <Sheet open={isAudioPanelOpen} onOpenChange={setAudioPanelOpen}>
         <UnifiedAudioPanel />
      </Sheet>
    );
};
