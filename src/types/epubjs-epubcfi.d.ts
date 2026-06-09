// epubjs ships types only for its package barrel ('epubjs'). We import the CFI class from its
// submodule ('epubjs/src/epubcfi') so DOM-heavy Book/Rendition code doesn't get bundled into the
// TTS engine worker. Map the submodule's default export to the barrel's EpubCFI type.
declare module 'epubjs/src/epubcfi' {
    import { EpubCFI } from 'epubjs';
    export default EpubCFI;
}
