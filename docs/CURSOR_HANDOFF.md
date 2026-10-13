# GuessNumber rebuild: Cursor Composer handoff

These prompts are meant to be pasted into Cursor Composer on your PC, **one phase at a time**, in a new monorepo (for example `guessnumber-v2`). Keep `GuessNumber_Rebuild_Spec.pdf` and the `mockups/` folder in the repository under `docs/`, and refer Composer to them. After each phase, review the diff, run the tests and commit before you start the next phase.

> Common preamble (paste at the top of every prompt):
> "Follow docs/GuessNumber_Rebuild_Spec.pdf. Use British English in UI text. Do not invent rules; where the spec lists an open question, implement the stated default and add a TODO. Write tests first for rules. Keep secrets server-side only."

---
## Phase 0: Skeleton and CI
```
Create a monorepo with folders engine/ (.NET 9 class library + xUnit tests), server/ (ASP.NET Core 9),
web/ (React 19 + TypeScript + Vite + React-Bootstrap), mobile/ (Expo, TypeScript), bot/ (.NET worker),
rl/ (Python 3.12, PyTorch, Gymnasium, pytest), shared/ts (shared TS types + SignalR client wrapper).
Add GitHub Actions running dotnet test, npm test (web, shared), and pytest (rl). Add .gitignore files
for .NET, Node and Python. Add docs/ containing the spec PDF and the mockups.
```

## Phase 1: Engine rules, number change, sampling-without-replacement solver
```
In engine/, implement:
- Ruleset (classic4 default: 4 distinct digits 1-9, 3,024 codes; also classic5 and pool0to9).
- Scorer.Score(guess, secret) -> (Dead, Wounded); Validator; Points = Dead*10 + Wounded*2 (solve = 40).
- Game aggregate: alternating turns, guess history, per-player running score, win on 4 dead.
- Number change: exactly two positions of own secret, costs 25, consumes the turn; enforce edge cases E1-E10
  from spec §3.3 with typed error codes (INSUFFICIENT_SCORE, CHANGE_LIMIT_REACHED, INVALID_CODE, ...).
  numberChange setting: once | unlimited | disabled. notifyOnChange emits OpponentChangedSecret{turn}.
- GameSettings record exactly as in spec §4 (agent: swor | dqn | double | duelling | doubleDuelling; per: bool).
- ISolver interface (§5) and SworSolver (port of getUniqueNumbers/makeAIGuess/filterAIPossibleNumbers
  from the legacy Scripts/GuessNumber.js), including OnOpponentChange with the N2 expansion and the
  unannounced-change detection from §5.4.
Tests: property-based scoring tests, one test per edge case E1-E10, solver always solves classic4 within
10 guesses on 500 fixed seeds, solver recovers after an announced and an unannounced change.
```

## Phase 2: Server
```
In server/, add GameHub (strongly typed IGameClient) with: CreateGame(settings), JoinQueue, InviteFriend,
RespondInvite, SetSecret, SubmitGuess, ChangeSecret(positions,newDigits), SendChat, Resign.
The server is authoritative: it validates the turn, membership and deadline, and never sends secrets to clients.
Persist Users, Games, Moves (guess or change), ChatMessages and Settings with EF Core + PostgreSQL;
use Redis for presence/queue and the SignalR backplane. Add ASP.NET Core Identity + JWT. Computer opponents
run in-process through ISolver; DQN agents load ONNX policies (Phase 4) through ONNX Runtime, falling back to
SworSolver if no model is present. Add integration tests with WebApplicationFactory for a full game against the computer.
```

## Phase 3: Web UI
```
In web/, build the Game, Lobby, Settings and History screens to match docs/mockups/*.png using React-Bootstrap.
Game table: rows appended top to bottom, one column per player, change rows annotated "−25",
and a Score row pinned in <tfoot> (sticky) under each player's column. Number-change dialog: select exactly
two positions, live validation, cost preview, and a notice about whether the opponent will be notified.
Settings tab: number change (once/unlimited/disabled), notify opponent, turn timer, agent type
(Sampling without replacement, DQN, Double DQN, Duelling DQN, Double + Duelling) and a PER toggle
(disabled when sampling without replacement is chosen). Escape all user text. Playwright end-to-end tests: a
human-vs-human game with one change; insufficient-score rejection; settings persistence.
```

## Phase 4: RL package and agents
```
In rl/, implement a Gymnasium env that is bit-identical to the engine rules (add a parity test against a
JSON test vector exported from engine/). Implement two configurations:
- R0 "faithful port" of the legacy TF.js code: constant state, shifting index action into the filtered
  list, reward 100 / dead*10+wounded*2, Dense128-128, and the legacy PER exponent behaviour and biased
  exploration; use it only to replicate the paper.
- R1 "corrected": state = 3,024-bit candidate mask (+ turn, last feedback), fixed action indices with
  illegal-action masking, uniform exploration over legal actions, standard PER (p^α/Σp^α, IS weights with
  β annealed to 1).
Agents: DQN, Double DQN, Duelling DQN (V + A − mean_legal A), Double+Duelling, each with per=True
(prioritised replay) or per=False (uniform minibatch sampling WITHOUT replacement). Rainbow is out of scope.
Number-change handling as in spec §5.4 (mask recomputation, stale tagging, temporary ε boost).
Export trained policies to ONNX for the server. Unit tests for the buffers, the targets and the masking.
```

## Phase 5: Experiment harness
```
In rl/experiments/, add a YAML-driven runner. Primary matrix: {dqn, double, duelling, doubleDuelling} ×
{per on, per off}, ONE shared hyperparameter set (spec §7.2), seeds 0-9 × 1,000 episodes, on the variants
classic4/classic5/pool0to9 × reward shaped/sparse × number change off/on (notify on/off). References:
random legal policy and sampling without replacement. Also: an R0 replication run with the Table 1
hyperparameters; a PER ablation (α, β0, buffer); an equal-budget Optuna sensitivity run (30 trials each, seeds 100-104).
Log to Parquet: episode reward, success, cumulative reward, guesses, loss, TD error, priority, IS
weight, ε, stale-sample fraction, wall-clock time and steps/s. Report: learning curves with 95% bootstrap CIs, success
rate, cumulative reward, sample efficiency (episodes to 95% success), loss distributions, guesses to solve
on 500 held-out secrets, robustness after a change, IQM/performance profiles (rliable), Welch and Mann-Whitney
tests with Holm correction and effect sizes, head-to-head against sampling without replacement. Figures at 300 dpi, plus
LaTeX tables. One command: `python -m gn_rl.report runs/ --out paper_figs/`.
```

## Phase 6: Mobile
```
In mobile/ (Expo), reuse shared/ts types and the SignalR wrapper. Screens: Game (same table with a sticky
Score row, keypad and change button), Lobby, Settings and History, matching docs/mockups/mobile.png.
Offline mode against sampling without replacement uses a TypeScript port of the scorer and solver, with parity tests
against the engine test vector.
```

## Phase 7: Telegram and WhatsApp bot
```
In bot/, add a worker exposing Telegram Bot API and WhatsApp Cloud API webhooks that map to the engine commands:
/new <agent> [per], /secret 1234, /guess 1234, /change 1:4 3:1, /score, /settings, /resign.
Render the table as monospaced text with the Score line last. Store tokens in user secrets or environment
variables only. Add tests with recorded webhook payloads.
```

---
### Notes
- Confirm the open questions in spec §10 (in particular, what "sampling without replacement" means with PER off, and which configuration produced the published figures) before you run Phase 5 for the paper.
- Run Phases 1, 4 and 5 first if the IJ-AI revision deadline is the priority.
