import { SeededRandom } from './src/test/fuzz-utils.ts';
const prng = new SeededRandom(0);

const genPath = (depth) => {
    const steps = [];
    for(let i=0; i<depth; i++) {
        steps.push(`/${prng.nextInt(2, 40)}`); // Evens usually for elements
        if (prng.next() > 0.8) steps.push(`[id${prng.nextInt(1, 100)}]`);
    }
    return steps.join('');
};
console.log(genPath(2))
