import '../src/config/env.ts';
import { responsesClient } from '../src/services/llm/responsesClient.ts';
import { z } from 'zod';

async function main() {
  const result = await responsesClient.runStructured({
    systemPrompt: 'Return JSON only: {"x":1}',
    userPrompt: 'go',
    schema: z.object({ x: z.number() }),
    fallback: () => ({ x: 0 }),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
