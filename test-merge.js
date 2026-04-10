import { mergeCfiSlow, tryFastMergeCfi } from './src/lib/cfi-utils.ts';
console.log("slow: ", mergeCfiSlow('epubcfi(/6/14!/4/20:0)', 'epubcfi(/6/14!/4/20:10)'));
console.log("fast: ", tryFastMergeCfi('epubcfi(/6/14!/4/20:0)', 'epubcfi(/6/14!/4/20:10)'));
