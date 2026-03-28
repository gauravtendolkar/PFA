/**
 * Interactive CLI for talking to the PFA agent.
 * Usage: npm run agent
 */
import readline from 'readline';
import { migrate } from '../db/index.js';
import { runAgent } from './orchestrator.js';

async function main() {
  migrate();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let sessionId: string | undefined;

  console.log('PFA Agent (type "quit" to exit, "new" for new session)\n');

  const ask = () => {
    rl.question('you > ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) return ask();
      if (trimmed === 'quit') { rl.close(); process.exit(0); }
      if (trimmed === 'new') { sessionId = undefined; console.log('--- new session ---\n'); return ask(); }

      try {
        const response = await runAgent({
          message: trimmed,
          session_id: sessionId,
        });

        sessionId = response.session_id;

        if (response.tool_calls_made.length > 0) {
          console.log(`  [tools: ${response.tool_calls_made.join(', ')}]`);
        }
        console.log(`\npfa > ${response.message}\n`);
      } catch (err: any) {
        console.error(`\nerror: ${err.message}\n`);
      }

      ask();
    });
  };

  ask();
}

main();
