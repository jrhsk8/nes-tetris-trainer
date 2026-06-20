import { run, claudeCode } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

// Simple loop: an agent that picks open issues one by one and closes them.
// Run this with: npx tsx .sandcastle/main.mts
// Or add to package.json scripts: "sandcastle": "npx tsx .sandcastle/main.mts"

await run({
  // A name for this run, shown as a prefix in log output.
  name: "worker",

  // Sandbox provider — runs the agent inside an isolated container.
  sandbox: docker(),

  // The agent provider. Pass a model string to claudeCode() — sonnet balances
  // capability and speed for most tasks. Switch to claude-opus-4-7 for harder
  // problems, or claude-haiku-4-5-20251001 for speed.
  agent: claudeCode("claude-opus-4-8"),

  // Path to the prompt file. Shell expressions inside are evaluated inside the
  // sandbox at the start of each iteration, so the agent always sees fresh data.
  promptFile: "./.sandcastle/prompt.md",

  // Maximum number of iterations (agent invocations) to run in a session.
  // Each iteration works on a single issue. ~10 actionable issues remain; 25
  // leaves headroom for retries/blocked-then-unblocked re-picks. The run also
  // stops early when the prompt emits <promise>COMPLETE</promise>.
  maxIterations: 25,

  // Branch strategy — merge-to-head creates a temporary branch for the agent
  // to work on, then merges the result back to HEAD when the run completes.
  // This is required when using copyToWorktree, since head mode bind-mounts
  // the host directory directly (no worktree to copy into).
  branchStrategy: { type: "merge-to-head" },

  // Copy node_modules from the host into the worktree before the sandbox
  // starts. This avoids a full npm install from scratch on every iteration.
  // The onSandboxReady hook still runs npm install as a safety net to handle
  // platform-specific binaries and any packages added since the last copy.
  copyToWorktree: ["node_modules"],

  // Lifecycle hooks — commands grouped by where they run (host or sandbox).
  hooks: {
    sandbox: {
      // onSandboxReady runs once after the sandbox is initialised and the repo is
      // synced in, before the agent starts. Use it to install dependencies or run
      // any other setup steps your project needs.
      onSandboxReady: [
        { command: "npm install" },
        // Start the offline StackRabbit engine (baked into the image) in the
        // background and wait until /ping responds (which only happens after its
        // precompute finishes). Reached by the generator at $STACKRABBIT_URL.
        // Non-fatal: if it doesn't come up, only the engine-dependent issues are
        // affected — the rest of the AFK backlog still proceeds.
        {
          command:
            "cd /home/agent/stackrabbit && (PORT=3000 nohup node built/src/server/app.js > /tmp/stackrabbit.log 2>&1 &) ; " +
            "for i in $(seq 1 90); do curl -fsS http://127.0.0.1:3000/ping >/dev/null 2>&1 && { echo 'StackRabbit engine ready on :3000'; exit 0; }; sleep 1; done; " +
            "echo 'WARN: StackRabbit engine not ready after 90s; see /tmp/stackrabbit.log'; tail -n 20 /tmp/stackrabbit.log 2>/dev/null || true",
        },
      ],
    },
  },
});
