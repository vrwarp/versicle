import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';
import { describe, it, expect, vi } from 'vitest';

describe('Input', () => {
  it('renders correctly', () => {
    render(<Input placeholder="Enter text" type="text" />);
    const input = screen.getByPlaceholderText('Enter text');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'text');
  });

  it('renders with custom type', () => {
    render(<Input type="password" data-testid="password-input" />);
    const input = screen.getByTestId('password-input');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('handles onChange events', () => {
    const handleChange = vi.fn();
    render(<Input onChange={handleChange} data-testid="change-input" />);

    const input = screen.getByTestId('change-input');
    fireEvent.change(input, { target: { value: 'new value' } });

    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('forwards ref correctly', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('merges custom className with default classes', () => {
    render(<Input className="my-custom-class" data-testid="class-input" />);

    const input = screen.getByTestId('class-input');
    expect(input).toHaveClass('my-custom-class');
    expect(input).toHaveClass('flex', 'h-9', 'w-full', 'rounded-md'); // checking some default classes
  });

  it('handles disabled state', () => {
    render(<Input disabled data-testid="disabled-input" />);

    const input = screen.getByTestId('disabled-input');
    expect(input).toBeDisabled();
    expect(input).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50');
  });
});
