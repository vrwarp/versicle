import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ThemeSelector } from './ThemeSelector';

describe('ThemeSelector', () => {
  it('renders all theme options', () => {
    render(
      <ThemeSelector
        currentTheme="light"
        onThemeChange={vi.fn()}
      />
    );

    expect(screen.getByText('White')).toBeInTheDocument();
    expect(screen.getByText('Sepia')).toBeInTheDocument();
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });

  it('highlights the current theme', () => {
    const { rerender } = render(
      <ThemeSelector
        currentTheme="light"
        onThemeChange={vi.fn()}
      />
    );

    const lightBtn = screen.getByText('White');
    expect(lightBtn).toHaveClass('ring-2');

    rerender(
      <ThemeSelector
        currentTheme="dark"
        onThemeChange={vi.fn()}
      />
    );
    const darkBtn = screen.getByText('Dark');
    expect(darkBtn).toHaveClass('ring-2');
  });

  it('calls onThemeChange when clicked', () => {
    const handleChange = vi.fn();
    render(
      <ThemeSelector
        currentTheme="light"
        onThemeChange={handleChange}
      />
    );

    fireEvent.click(screen.getByText('Sepia'));
    expect(handleChange).toHaveBeenCalledWith('sepia');
  });
});
