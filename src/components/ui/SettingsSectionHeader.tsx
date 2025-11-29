import React from 'react';

interface SettingsSectionHeaderProps {
  title: string;
}

export const SettingsSectionHeader: React.FC<SettingsSectionHeaderProps> = ({ title }) => {
  return (
    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 mt-4 first:mt-0 px-1">
      {title}
    </h4>
  );
};
