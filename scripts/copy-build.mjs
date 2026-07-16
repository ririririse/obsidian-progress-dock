import { copyFile, mkdir } from "node:fs/promises";

await mkdir(new URL("../release/", import.meta.url), { recursive: true });
await Promise.all([
  copyFile(new URL("../build/main.js", import.meta.url), new URL("../main.js", import.meta.url)),
  copyFile(new URL("../build/main.js", import.meta.url), new URL("../release/main.js", import.meta.url)),
  copyFile(new URL("../manifest.json", import.meta.url), new URL("../release/manifest.json", import.meta.url)),
  copyFile(new URL("../styles.css", import.meta.url), new URL("../release/styles.css", import.meta.url)),
]);
