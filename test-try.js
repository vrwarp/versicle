import { mergeCfiSlow, tryFastMergeCfi } from './src/lib/cfi-utils.ts';
const slow = mergeCfiSlow('epubcfi(/6/14[chapter1]!/4[id0]/12/2:0)', 'epubcfi(/6/14[chapter1]!/4[id0]/12/2:10)');
const fast = tryFastMergeCfi('epubcfi(/6/14[chapter1]!/4[id0]/12/2:0)', 'epubcfi(/6/14[chapter1]!/4[id0]/12/2:10)');
console.log("slow: ", slow);
console.log("fast: ", fast);
