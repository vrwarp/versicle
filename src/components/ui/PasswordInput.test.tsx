import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasswordInput } from './PasswordInput';
import { describe, it, expect } from 'vitest';

describe('PasswordInput', () => {
  it('renders with type password by default', () => {
    render(<PasswordInput placeholder="Enter password" />);
    const input = screen.getByPlaceholderText('Enter password');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('toggles visibility when button is clicked', () => {
    render(<PasswordInput placeholder="Enter password" />);
    const input = screen.getByPlaceholderText('Enter password');
    const button = screen.getByLabelText('Show password');

    // Initially password
    expect(input).toHaveAttribute('type', 'password');

    // Click to show
    fireEvent.click(button);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Hide password')).toBeInTheDocument();

    // Click to hide
    fireEvent.click(button);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Show password')).toBeInTheDocument();
  });

  it('forwards refs correctly', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<PasswordInput ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
