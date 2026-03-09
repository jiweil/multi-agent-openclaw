import { generatePlan, executePlan, type Account } from "./planner.js";

// --- Example usage ---
// In a real app this comes from user input (CLI prompt, web form, etc.)

const accounts: Account[] = [
  { id: "alice", username: "alice_tweets", password: "***" },
  { id: "bob", username: "bob_tweets", password: "***" },
  { id: "charlie", username: "charlie_tweets", password: "***" },
];

const goal = "Each account posts a tweet, then the other two accounts like it.";

async function main() {
  console.log("=== Multi-Agent OpenClaw ===\n");
  console.log(`Goal: ${goal}`);
  console.log(`Accounts: ${accounts.map(a => a.username).join(", ")}\n`);

  // Step 1: Generate a plan using OpenClaw's planner agent
  console.log("1. Planning...");
  const plan = await generatePlan({ goal, accounts });
  console.log(`   Generated ${plan.steps.length} steps:\n`);
  for (const step of plan.steps) {
    const deps = step.dependsOn?.length ? ` (after: ${step.dependsOn.join(", ")})` : "";
    console.log(`   [${step.agentId}] ${step.instruction.slice(0, 100)}${deps}`);
  }

  // Step 2: Execute the plan
  console.log("\n2. Executing...\n");
  const { results } = await executePlan(plan, {
    onStep: (step, result) => {
      const status = result.ok ? "✓" : "✗";
      console.log(`   ${status} [${step.agentId}] done\n`);
    },
  });

  // Step 3: Summary
  console.log("\n3. Summary\n");
  const succeeded = results.filter(r => r.ok).length;
  console.log(`   ${succeeded}/${results.length} steps completed successfully.`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
