import { readFile } from "fs/promises";
import path from "path";

type EvalSeed = {
  name: string;
  input: { url?: string; rawText?: string; companyHint?: string };
  expectedBand: [number, number];
};

const main = async () => {
  const seedPath = path.resolve(process.cwd(), "scripts/eval-seed.json");
  const raw = await readFile(seedPath, "utf8");
  const rows = JSON.parse(raw) as EvalSeed[];

  const { triageJob } = await import("../apps/api/src/agents/jobAgent/orchestrator.js");

  let failures = 0;
  for (const row of rows) {
    const result = await triageJob({ ...row.input, fullPrep: false });
    const [min, max] = row.expectedBand;
    const pass = result.score.total >= min && result.score.total <= max;
    if (!pass) failures += 1;
    console.log(`${pass ? "PASS" : "FAIL"} | ${row.name} | score=${result.score.total} expected=${min}-${max}`);
  }

  if (failures > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
