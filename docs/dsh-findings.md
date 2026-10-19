# What Roux can borrow from DeepSeek Harness

October 19, 2026. DeepSeek Harness (`dsh`, [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), MIT) is DeepSeek's open-source agent harness: their counterpart to Claude Code, built so their own models work at their best. This report reads its source for patterns that would make Roux 1 (DeepSeek V4.1 Flash running Gumbo's agent) cheaper, faster or better, compared against Gumbo's engine in `packages/orchestrator/src`.

**Recommendation:** borrow patterns, do not adopt the framework. dsh is a developer preview ("THERE WILL BE COMPATIBILITY-BREAKING CHANGES"), and Gumbo's engine carries things dsh does not know about: the credit pause and step limits, resume after Stop, checkpoints in the project database, billing through the gateway, the scene engine and scene errors, picture notes and cold-cache shrinking.

What Roux showed on real edits (October 18-19): about 2.5 times cheaper than GPT-6.1 Sol (a 10-minute highlight for about 40 cents), good judgment and self-correction, but many steps; re-looking at footage after the conversation was summarized; polishing a finished edit for a long time; and an occasional DeepSeek cache miss (about 2% of steps).

Links to dsh are to `main`; paths are relative to its repository root.

## Ranked

### 1. Give DeepSeek its real context window (high impact, small effort)

- **dsh:** DeepSeek V4 Flash and Pro are declared with a 1,000,000-token window. Compaction starts at `min(W x 0.8, W - output - 65,536)` and keeps the newest 16% verbatim ([routed model context and compaction policy](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/implemented/architecture/2026-07-20-routed-model-context-and-compaction-policy.md), [compaction-basic](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/compaction/compaction-basic/README.md)). On DeepSeek a conversation is practically never summarized.
- **Gumbo:** the editing agent summarizes past 90K tokens (`engineBudgets.workingInput` in `packages/config/src/index.ts`), and `budgetRequest` caps non-Claude-5.5 models at 200K (`packages/orchestrator/src/context-budget.ts`).
- **Effect on Roux:** most of its re-looking came right after summaries, which drop what it saw in the footage. On DeepSeek a cached token costs a few thousandths of a cent, so carrying 300K tokens is about 0.2 credits a step. Fewer summaries means fewer re-looks and fewer full-price re-sends.
- **Do:** a per-model working target (for example 400K for DeepSeek, keeping 90K for others), and the real window as its hard limit. First confirm V4.1 Flash's window in DeepSeek's model list.

### 2. Keep DeepSeek's thinking across steps (high impact, medium effort)

- **dsh:** talks to DeepSeek through its Anthropic-compatible Messages API (`https://api.deepseek.com/anthropic`). Thinking is on by default at `high` (`off|low|high|max`), and earlier thinking blocks go back with their signatures on every following step ([llm-deepseek serialize.ts](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/llm/llm-deepseek/src/serialize.ts), [config.ts](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/llm/llm-deepseek/src/config.ts)).
- **Gumbo:** the gateway sends DeepSeek the OpenAI-style chat API (`supabase/functions/dream-gateway/providers.ts`, `api:'chat'`) and rebuilds each assistant turn as text plus tool calls, dropping the model's earlier reasoning. Every step reasons from scratch.
- **Effect on Roux:** continuity of its own plan across steps (fewer repeated checks, fewer "let me map this again" steps), and a simpler gateway path. Gumbo's messages are already in Anthropic format, the format Claude requests already go through.
- **Do:** route `deepseek-flash` to the Messages endpoint with thinking replay. Map its usage fields for billing (including cache hits). Then A/B five real edits against the chat route on steps, credits and outcome.

### 3. Summaries written by the model, as a structured checkpoint (high impact, medium effort)

- **dsh:** when it does summarize, the model writes a checkpoint in fixed sections (Primary Request and Intent, Files and Code, Errors and Fixes, Pending Jobs, Current Work, Next Step, Critical Context). The summary call replays the conversation's exact start, so all but the instruction and the summary are cache hits ([summarizer.ts](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/compaction/compaction-basic/src/summarizer.ts)). Optional add-ons move images out and trim oversized tool results before summarizing, which can avoid the summary altogether ([compaction-image-offload](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/compaction/compaction-image-offload), [compaction-tool-result-pruner](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/compaction/compaction-tool-result-pruner)).
- **Gumbo:** compaction archives older exchanges mechanically (`planCompaction` in `packages/orchestrator/src/conversation.ts`). Only file reads survive (`working-context.ts`); what the agent learned from looking does not.
- **Effect on Roux:** with a "What I saw in the footage" section (clip, time range, what is there), a summary keeps the observations it would otherwise re-look for. The same notes are worth saving to the project's source notes as the agent goes.
- **Do:** a checkpoint instruction adapted to editing (request, edit so far, footage seen, open problems, next step), run as a cache-hit call on the same model.

### 4. Advisory repeat-call reminders (medium impact, small effort)

- **dsh:** when the model makes the exact same tool call with identical arguments 3, 5 or 8 times in a row, a short reminder after the result asks it to read the previous result and change approach or finish. It never blocks a call ([repeat-tool-reminder](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/guard/repeat-tool-reminder/README.md)).
- **Gumbo:** counts repeated failures (the same error 3 times ends the request), but not repeated successful calls, such as viewing the same footage again or re-running the same inspection command.
- **Effect on Roux:** catches re-look loops and long polishing loops early, without stopping legitimate repeats. It pairs with the stall-stop task proposed earlier.

### 5. Spill large tool outputs to a file (medium impact, small to medium effort)

- **dsh:** a tool result over a token budget is replaced by a preview plus a file locator, and the model reads the rest with its normal file tools if it needs it ([tool output spill decision](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)).
- **Gumbo:** caps result text and drops the rest.
- **Effect on Roux:** its inspection commands on a big edit (listing a 10-minute cut) bring in 4-5K tokens a step. A preview plus a file keeps the conversation lean without losing anything.

### 6. Programmatic tool calling, "code mode" (possibly high impact, large effort)

- **dsh:** an optional mode in which the model writes a short TypeScript program against a generated SDK of its tools. The program runs in a sandboxed Node process, makes up to 10 tool calls in parallel, loops and filters, and only its output returns to the conversation ([PTC mode note](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/implemented/feature/2026-06-15-ptc.md)). Native one-call-per-step remains dsh's default.
- **Gumbo:** already lets the agent script edits with `run_command`, but looking (`view_media`, `find_shots`, `read_transcript`) is one tool call per step.
- **Effect on Roux:** surveys of long footage could be one step instead of ten. It is a big change to the agent's tool surface, so do it after 1-5 and measure.

### 7. A short persona, with guidance owned by each tool (low impact, medium effort)

- **dsh:** the persona is one sentence ("You are a coding agent powered by the {{model}} model."). Each tool contributes its own guidance section ([prompt variables and tool guidance ownership](https://github.com/deepseek-ai/deepseek-harness/blob/main/.agents/notes/implemented/architecture/2026-07-05-prompt-variables-and-tool-guidance-ownership.md), [standard preset](https://github.com/deepseek-ai/deepseek-harness/blob/main/packages/bundle/web-app/presets/standard.patch.yml)).
- **Gumbo:** a long system prompt holds most rules (`code-prompt.ts`), with short tool descriptions.
- **Effect:** uncertain. Worth trying only alongside an A/B on real edits.

## Not worth taking

- **The framework itself** (the Cordis plugin runtime, its sessions, storage, web UI, terminals, sandbox backends): Gumbo already owns each of these, fitted to video, and dsh is pre-stable.
- **Subagents:** Gumbo removed helpers on October 18; each paid full price to read the project.
- **The goal plugin:** a durable objective with complete and blocked states. Gumbo's `finish` with request-part checks covers it. The polishing problem needs a polish budget, not a goal store.

## Suggested order

1 and 4 first: small, and aimed at re-looking and loops. Then 2, as an A/B on real edits. Then 3 and 5. Then 6 only if steps are still the main cost.
