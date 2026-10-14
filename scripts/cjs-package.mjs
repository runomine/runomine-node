// Marks dist/cjs as CommonJS so Node and TypeScript treat its .js and .d.ts files as CJS,
// even though the package itself is "type": "module".
import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../dist/cjs/package.json', import.meta.url), '{\n  "type": "commonjs"\n}\n');
