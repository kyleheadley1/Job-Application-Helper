import { readFile, writeFile } from "fs/promises";
import path from "path";

const seedPath = path.resolve(process.cwd(), "scripts/eval-seed.json");
const outPath = path.resolve(process.cwd(), "scripts/eval-seed.snapshot.json");

const main = async () => {
  const seedRaw = await readFile(seedPath, "utf8");
  const seed = JSON.parse(seedRaw);
  await writeFile(outPath, JSON.stringify(seed, null, 2), "utf8");
  console.log(`Wrote eval snapshot seed to ${outPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
