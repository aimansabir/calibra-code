# CALIBRA CODE: Experimental Plan

HCI Final Project, Phase One

This plan describes how the CALIBRA CODE prototype will be evaluated. Every procedure, measure and allocation rule below is already built into the application in this repository, so the study can be run exactly as written.

## 1. Aim

CALIBRA CODE is a Python debugging workspace in which students get AI suggestions for fixing buggy code. The study asks whether *adaptive* verification (asking for more checking only when a suggestion looks risky) can keep students' reliance on the AI appropriate without the workload of checking every suggestion.

Research questions:

1. Can an adaptive AI coding interface reduce unnecessary cognitive load while helping students decide when to trust or question AI-generated code?
2. Which interface features support students of different programming ability without overwhelming them with explanations or verification steps?

## 2. Hypotheses

| | Hypothesis | Measure used to test it |
|---|---|---|
| H1 | CALIBRA CODE gives lower overreliance than Direct AI. | Share of incorrect suggestions that were accepted |
| H2 | CALIBRA CODE gives lower workload than Always Verify. | Raw TLX after each part |
| H3 | CALIBRA CODE improves appropriate reliance without lowering final code correctness. | Appropriate-reliance rate; share of submissions passing all visible and hidden tests |
| H4 | Beginners get strong support more often; experienced students get fewer unnecessary interruptions. | Support level chosen by the adaptive engine, split by proficiency group |
| H5 | Experience with adaptive verification helps on a later debugging task done without AI. | Correctness and time on the transfer task (exploratory, see 9.4) |

## 3. Design

A **within-subjects** controlled experiment with one independent variable, the *interface condition*, at three levels. Every participant uses all three conditions, so each person is compared with themselves and differences in individual skill largely cancel out.

| Condition | What the participant experiences |
|---|---|
| **Direct AI** | The AI diagnosis, rationale and patch appear as soon as the participant has written a diagnosis. No check is required. Evidence is not shown alongside. |
| **Always Verify** | Every suggestion comes with the participant's and the AI's diagnoses side by side, the evidence panel open, and a required *predict the output* question before Accept, Edit or Reject unlock. |
| **CALIBRA CODE (adaptive)** | The system picks low, medium or strong support for each suggestion from the rules in section 4. |

All three conditions use the same workspace, layout, labels and buttons; only the verification behaviour changes. Participants see "Part 1, Part 2, Part 3" and are never told the condition names.

**Things common to every condition:**

- The participant must write a diagnosis (at least 10 characters, plus an optional suspected line) before any advice is shown. The server enforces this, so it can't be skipped.
- The AI suggestions are written in advance with known correctness, so every participant sees identical advice for a given task. No live model is used.
- Participants can edit the code, run it, and run the visible tests at any time.
- The final decision is one of Accept (use the patch), Edit (start from the patch and change it) or Reject (go back to one's own code). If an accepted patch is then changed, the decision is automatically recorded as Edit.

## 4. Adaptive rules

The adaptive condition uses fixed, explainable rules, not a trained model. Each signal adds points to a risk score:

| Signal | Points |
|---|---|
| Code checker warning on the patch | +2 |
| Student's suspected line is more than one line away from the AI's target lines | +1 |
| Student said they were not sure which line is wrong | +1 |
| Task difficulty 2 / 3 | +1 / +2 |
| Proficiency: beginner / intermediate / experienced | +1 / 0 / −1 |
| The previous suggestion was accepted with no test runs, no evidence opened and no check | +2 |

Support level:

- **Strong** if the patch fails a visible test (regardless of score) or the score is 4 or more. The patch itself is withheld until the participant completes one check: inspecting a failing test if a test fails, the flagged suspicious line if there is a checker warning, and otherwise predicting the patch's output.
- **Medium** if the score is 2 or 3. Both diagnoses are shown side by side and the participant must answer one evidence question ("does the evidence support or contradict the suggestion?") before deciding.
- **Low** otherwise. The full suggestion is shown with the evidence one click away and no required check.

For example, with a student who agrees with the AI, *Sum of the first n numbers* (difficulty 1, correct advice) gets low support for everyone, whereas *Count the peaks* (difficulty 3, wrong advice with a checker warning) gets strong support for beginners and intermediates but only medium for experienced students. The level, score and the list of reasons are saved with every attempt.

## 5. Participants

- **Who:** Computer Science students who know basic Python, across a range of years and experience levels.
- **How many:** 24 participants as the target, 18 as the practical minimum. 24 is a multiple of the six condition orders, so each order is used by exactly four people.
- **Recruitment:** voluntary, through class announcements. Taking part or not has no effect on grades, and participants can stop at any time without penalty.
- **Proficiency groups:** a six-question Python quiz at the start classifies each participant as beginner (0–2 correct), intermediate (3–4) or experienced (5–6). The groups are used by the adaptive rules and in the H4 analysis.

## 6. Materials

Eight debugging tasks, each stored as a folder in `tasks/` (task description, starter code, AI patch, correct solution, visible and hidden tests, and evidence). Correctness of every patch and solution is checked by the automated test suite.

| Role | Pair | Task | Bug type | Difficulty | AI advice | Tests (hidden) |
|---|---|---|---|---|---|---|
| Practice | – | Count the vowels | Incorrect condition | 1 | correct | 5 (2) |
| Experimental | A | Sum of the first n numbers | Off-by-one loop | 1 | correct | 6 (3) |
| Experimental | A | Letter grades | Incorrect condition | 1 | **wrong** (fails a visible test) | 8 (5) |
| Experimental | B | Average of positive numbers | Return placement | 2 | correct | 6 (3) |
| Experimental | B | Second largest value | Missing edge case | 2 | **partly wrong** (passes visible tests) | 7 (4) |
| Experimental | C | Course averages | Dictionary key handling | 3 | correct | 6 (3) |
| Experimental | C | Count the peaks | List index handling | 3 | **wrong** (passes visible tests) | 9 (5) |
| Transfer | – | Longest practice streak | Missing edge case | 2 | no AI | 7 (4) |

Each pair has one correct and one incorrect suggestion at the same difficulty. So within any condition a participant sees exactly one correct and one incorrect suggestion, and a condition can never get easier tasks or more accurate advice than another. Two of the wrong suggestions pass every visible test, which is the realistic case where checking the evidence actually matters.

## 7. Counterbalancing

The server assigns each new participant the least-used of the six possible condition orders, so dropouts don't unbalance the design. Demo sessions are not counted. A researcher can also pin an order with a link such as `/?order=3`.

| Order | Part 1 | Part 2 | Part 3 |
|---|---|---|---|
| 1 | Direct AI | Always Verify | CALIBRA CODE |
| 2 | Always Verify | CALIBRA CODE | Direct AI |
| 3 | CALIBRA CODE | Direct AI | Always Verify |
| 4 | Direct AI | CALIBRA CODE | Always Verify |
| 5 | CALIBRA CODE | Always Verify | Direct AI |
| 6 | Always Verify | Direct AI | CALIBRA CODE |

Orders 1–3 and 4–6 are each a Latin square, and together they balance which condition follows which. On top of this, the task pairs rotate across conditions (each pair meets each condition equally often), and whether the correct or the incorrect suggestion comes first within a part alternates. Over every block of six participants this cancels out order, pair and position effects.

## 8. Procedure

One session takes about 45–50 minutes, one participant at a time, on a study laptop with the app open in a browser.

| Step | What happens | Time |
|---|---|---|
| 1 | Study information, voluntary-participation and consent statement, anonymous ID (generated, or given by the researcher) | 3 min |
| 2 | Background questions (year, experience, Python confidence, AI tool use) and the 6-question proficiency quiz | 5 min |
| 3 | Instructions, then a practice task using the Always Verify behaviour so every control is tried once. Not analysed. | 5 min |
| 4 | Part 1: two tasks, each followed by four short ratings | 8 min |
| 5 | Part 1 questionnaire: Raw TLX, SUS, agency and trust items, optional comment | 3 min |
| 6 | Parts 2 and 3, same as steps 4–5 | 22 min |
| 7 | Transfer task with no AI, then the ratings | 5 min |
| 8 | Final questions: which part they prefer overall, found easiest for deciding when to trust the AI, and found least demanding; three open questions | 3 min |
| 9 | Debrief: what the study was about, and a table showing which suggestions were intentionally wrong and why | 2 min |

The researcher stays nearby but doesn't help with the tasks. If a participant asks for help, the only answer given is "do whatever you would normally do". Technical problems are noted in a session log.

### Pilot

Before data collection, 2–3 pilot sessions will be run with students who won't take part in the main study, to check timing, instructions and wording. Pilot sessions use demo mode (`/?demo=1`), so they are kept out of the study exports automatically. Changes after the pilot are limited to wording and are recorded.

## 9. Measures

### 9.1 Per task (saved automatically)

| Measure | Definition |
|---|---|
| Decision | Accept, Edit or Reject, plus the full history of changes with timestamps |
| Reliance | *Appropriate*: accepting a correct suggestion, rejecting a wrong one, or editing to fully working code. *Over*: accepting a wrong suggestion, or editing it into code that still fails. *Under*: rejecting a correct suggestion. *Mixed*: editing a correct suggestion into failing code. |
| Final correctness | Visible and hidden tests passed by the submitted code. Hidden tests run only on the server and are never shown to the participant. |
| Completion time | From the task opening to submission, including advice and verification time. Diagnosis, advice, verification and decision timestamps are saved too. |
| Evidence use | Code runs, test runs (and test runs after advice), evidence panel opens, verification answer and whether it was right |
| Adaptive record | Every signal value, support level, score and the reasons behind it |
| Ratings | Confidence, difficulty, AI helpfulness and mental effort, each 1–7 |

### 9.2 Per condition

- **Workload:** Raw TLX, the unweighted mean of the six NASA-TLX subscales, each rated 0–100 in steps of 5. Performance is anchored "Perfect" to "Failure", so higher always means more workload.
- **Usability:** System Usability Scale, standard 10 items with "system" replaced by "interface in this part", scored 0–100.
- **Agency and trust:** four 1–7 items (control over the final code, able to disagree with the AI, confidence in decisions, trust in the AI).

### 9.3 Once per session

Final preference questions (converted on the server from "Part N" into the condition shown in that part) and open comments about useful support, interruptions and confusing behaviour.

### 9.4 Transfer

Correctness (hidden tests included) and time on the no-AI transfer task. Because every participant uses all three interfaces, H5 can only be looked at through which condition came just before the transfer task, so it is reported as exploratory.

## 10. Data recording and storage

- All records are tied to the anonymous participant ID, the condition and the task ID. No names or student numbers are collected.
- The server stores five append-only collections (participants, sessions, attempts, surveys, events) in the data folder. Because nothing is overwritten, a crash loses at most the last line written.
- Events are queued in the browser and resent if the connection drops. A reload resumes the participant at the same step.
- Researcher-only material (hidden tests, solutions, answer keys, AI correctness labels and notes) never leaves the server. The build includes a check that fails if any of it appears in the browser bundle.
- Data is exported as CSV or JSON from `/researcher`, protected by a research key set on the server. Demo sessions are excluded unless asked for.

## 11. Analysis plan

Run `npm run analyze` to produce all tables below from the stored data (`analysis/out/summary.md`, plus CSV files).

1. **Unit of analysis.** For each participant and condition, take the mean over that condition's two tasks (for example, overreliance = share of the incorrect suggestion(s) accepted). This gives one value per participant per condition.
2. **Descriptives.** Mean (SD) and median [IQR] per condition for appropriate reliance, overreliance, underreliance, final correctness, completion time, evidence use, Raw TLX, SUS, agency and confidence. Participant-level plots (paired dot or line plots) to show individual variation.
3. **Omnibus test.** With 18–24 participants and proportions built on few tasks, normality can't be assumed, so the main test is the **Friedman test** across the three conditions, reported as χ²(2), p and Kendall's W as the effect size.
4. **Follow-up comparisons.** Pairwise **Wilcoxon signed-rank tests** (CALIBRA CODE vs Direct AI, CALIBRA CODE vs Always Verify, Always Verify vs Direct AI) with **Holm correction** within each measure. These map onto the hypotheses: H1 uses the overreliance comparison with Direct AI; H2 the TLX comparison with Always Verify; H3 appropriate reliance and correctness.
5. **H4.** Cross-tabulate the support level chosen in the adaptive condition by proficiency group, and report the share of low-support (uninterrupted) tasks per group.
6. **H5.** Transfer correctness and time, split by the condition just before the transfer task. Descriptive only.
7. **Qualitative.** Open comments are exported to `comments.csv` with an empty theme column. Two team members code them independently into themes (helpful evidence, unnecessary interruption, confusion, trust, perceived control, other), settle disagreements by discussion, and report theme counts per condition with representative quotes.
8. **Significance level** α = .05 after correction. With this sample size, effect sizes and medians matter more than p-values, and results are reported as a class-scale study, not a confirmatory one.

### Exclusions (decided in advance)

- Practice-task data is never analysed.
- Demo and pilot sessions are excluded automatically.
- Participants who don't finish all three parts are excluded from the paired tests (their data is kept and reported).
- Tasks with a recorded technical failure (e.g. the Python runtime not loading) are excluded and the number is reported.

## 12. Ethics

- Voluntary participation, stated before consent, with the right to stop at any time without penalty.
- Anonymous IDs only. No link between study data and course grades or student identities.
- Data access limited to the project team and supervisor; exports are protected by a research key.
- The AI is presented as sometimes wrong in the instructions. Afterwards, the debrief explains that some suggestions were intentionally incorrect and shows which ones.
- The consent text and procedure will be checked against the institution's requirements before recruitment starts.

## 13. Threats to validity and mitigations

| Threat | Mitigation |
|---|---|
| Learning and fatigue across parts | Six counterbalanced orders, a practice task, short tasks, about 45 minutes in total |
| Some tasks easier than others | Pairs matched on difficulty, one correct and one wrong suggestion per condition, pairs rotated across conditions |
| Participants guessing which suggestions are wrong | Correct-first versus wrong-first alternates; the debrief asks participants not to share the answers |
| Condition labels influencing behaviour | Condition names are never shown; only "Part 1/2/3" |
| Variable AI output | Pre-written advice with known correctness; no live model in study mode |
| Small sample | Within-subjects design, non-parametric tests, effect sizes reported |
| Lab artificiality | Real, editable and runnable Python with tests, rather than static multiple-choice items |

## 14. Researcher checklist for each session

1. Start the server (`npm run build` once, then `npm start`) and open `/researcher` to check the order balance.
2. Open the app in a fresh browser window on the study laptop. Use `/?order=N` only if an order has to be pinned.
3. Read the short verbal introduction, let the participant read the information screen, and stay out of the tasks.
4. After the debrief, click "Finish and close the session" so the next participant starts clean.
5. At the end of each day, export the CSVs and store them in the project's restricted folder.
