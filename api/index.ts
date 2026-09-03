import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { app } from '../src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

export default app;
export * from '../src/server.js';
