import { cp, copyFile, rm } from "node:fs/promises";

await copyFile("dist/index.html", "index.html");
await rm("assets", { recursive: true, force: true });
await cp("dist/assets", "assets", { recursive: true });
