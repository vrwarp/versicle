import { describe, it, expect, beforeEach } from 'vitest';
import { CostEstimator, useCostStore } from './CostEstimator';

describe('CostEstimator', () => {
    beforeEach(() => {
        useCostStore.setState({ sessionCharacters: 0 });
    });

    it('tracks usage correctly', () => {
        const estimator = CostEstimator.getInstance();
        estimator.track('hello');
        expect(estimator.getSessionUsage()).toBe(5);
        estimator.track(' world');
        expect(estimator.getSessionUsage()).toBe(11);
    });

    it('estimates cost correctly for Google', () => {
        const estimator = CostEstimator.getInstance();
        const text = 'a'.repeat(1_000_000);
        const cost = estimator.estimateCost(text, 'google');
        // $16 per million
        expect(cost).toBeCloseTo(16.00, 2);
    });

    it('estimates cost correctly for OpenAI', () => {
        const estimator = CostEstimator.getInstance();
        const text = 'a'.repeat(1_000);
        const cost = estimator.estimateCost(text, 'openai');
        // $0.015 per 1000
        expect(cost).toBeCloseTo(0.015, 3);
    });
});
