import { migrate, closeDb } from './index.js';

migrate();
closeDb();
console.log('Migration complete.');
