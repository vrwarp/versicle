declare module 'snapdom' {
    interface SnapdomOptions {
        format?: 'png' | 'jpeg' | 'webp';
        quality?: number;
        scale?: number;
    }

    function snapdom(element: HTMLElement, options?: SnapdomOptions): Promise<Blob>;
    export default snapdom;
}
