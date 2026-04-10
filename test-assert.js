import { parseCfiRange } from './src/lib/cfi-utils.ts';
const a = parseCfiRange('epubcfi(/6/14!/4,/20:0,/20:10)');
const b = parseCfiRange('epubcfi(/6/14!/4/20,:0,:10)');
console.log(a);
console.log(b);
