// One-shot local setup: create .env from the example if it doesn't exist.
// (npm install is run separately so this stays dependency-free.)
import { existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const env = resolve(root, ".env");
if (existsSync(env)) {
  console.log(".env already exists — leaving it alone.");
} else {
  copyFileSync(resolve(root, ".env.example"), env);
  console.log("Created .env from .env.example. Add your AI_API_KEY to it.");
}
console.log("Next: npm run dev");
