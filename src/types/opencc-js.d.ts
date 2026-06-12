/**
 * Minimal ambient types for opencc-js (the package ships none).
 * Only the surface Versicle uses is declared: the locale-pair converter
 * factory consumed by domains/chinese/engine/TraditionalConverter.ts.
 */
declare module 'opencc-js' {
  export interface ConverterOptions {
    from: string;
    to: string;
  }
  export function Converter(options: ConverterOptions): (text: string) => string;
}
