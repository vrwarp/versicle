import React from 'react';
import { render, screen } from '@testing-library/react';
import { Slider } from './Slider';
import { describe, it, expect } from 'vitest';

describe('Slider', () => {
    it('passes aria-label to the thumb', () => {
        render(<Slider defaultValue={[50]} max={100} step={1} aria-label="Volume Control" />);
        const thumb = screen.getByRole('slider');
        expect(thumb).toHaveAttribute('aria-label', 'Volume Control');
    });

    it('passes aria-labelledby to the thumb', () => {
        render(
            <>
                <label id="slider-label">Volume</label>
                <Slider defaultValue={[50]} max={100} step={1} aria-labelledby="slider-label" />
            </>
        );
        const thumb = screen.getByRole('slider');
        expect(thumb).toHaveAttribute('aria-labelledby', 'slider-label');
    });

    it('passes aria-valuetext to the thumb', () => {
        render(<Slider defaultValue={[50]} max={100} step={1} aria-valuetext="50 percent" />);
        const thumb = screen.getByRole('slider');
        expect(thumb).toHaveAttribute('aria-valuetext', '50 percent');
    });

    it('passes aria-describedby to the thumb', () => {
        render(
            <>
                <p id="slider-desc">Adjust the volume level.</p>
                <Slider defaultValue={[50]} max={100} step={1} aria-describedby="slider-desc" aria-label="Volume" />
            </>
        );
        const thumb = screen.getByRole('slider');
        expect(thumb).toHaveAttribute('aria-describedby', 'slider-desc');
    });
});
