export type Condition = 'direct' | 'always' | 'adaptive';
export type SupportLevel = 'low' | 'medium' | 'strong';
export type Proficiency = 'beginner' | 'intermediate' | 'experienced';
export type Decision = 'accept' | 'edit' | 'reject';
export type TaskRole = 'practice' | 'experimental' | 'transfer';
export type Correctness = 'correct' | 'partial' | 'incorrect';
export type PatchEvidence = 'pass' | 'partial' | 'fail';
export type Reliance = 'appropriate' | 'over' | 'under' | 'mixed' | 'none';

export type VerificationActivity =
  | 'none'
  | 'evidence_check'
  | 'failing_test'
  | 'suspicious_line'
  | 'predict_output';

export interface TestCase {
  name: string;
  call: string;
  expected: string;
  hidden?: boolean;
}

export interface TestResult extends TestCase {
  actual?: string;
  passed: boolean;
  error?: string;
  stdout?: string;
}

export interface StaticWarning {
  line: number;
  message: string;
}

export interface ChoiceCheck {
  question: string;
  options: string[];
  answer: string;
}

export interface PredictionCheck extends ChoiceCheck {
  call: string;
}

export interface SuspiciousLineCheck extends ChoiceCheck {
  line: number;
}

export interface AiAdvice {
  correctness: Correctness;
  diagnosis: string;
  rationale: string;
  targetLines: number[];
  // researcher-facing, shown in the debrief only
  note: string;
}

export interface TaskDef {
  id: string;
  role: TaskRole;
  pair?: string;
  title: string;
  bugType: string;
  difficulty: 1 | 2 | 3;
  functionName: string;
  objective: string;
  expected: string;
  examples: string[];
  constraints: string[];
  tests: TestCase[];
  advice: AiAdvice | null;
  patchVisible?: PatchEvidence;
  evidence: {
    staticWarnings: StaticWarning[];
    prediction?: PredictionCheck;
    failingTestCheck?: ChoiceCheck;
    suspiciousLineCheck?: SuspiciousLineCheck;
  };
  starterCode: string;
  solutionCode: string;
  patchCode: string | null;
}

export interface Participant {
  id: string;
  createdAt: string;
  isDemo: boolean;
  yearOfStudy: string;
  experience: string;
  pythonConfidence: number;
  aiToolUse: string;
  consent: boolean;
  proficiencyScore?: number;
  proficiency?: Proficiency;
  proficiencyAnswers?: Record<string, string>;
  orderIndex?: number;
  conditionOrder?: Condition[];
  completedAt?: string;
}

export interface PlannedTask {
  taskId: string;
  condition: Condition | null;
  block: number | null;
  indexInBlock: number;
  role: TaskRole;
}

export interface StudyPlan {
  orderIndex: number;
  conditionOrder: Condition[];
  pairByCondition: Record<Condition, string>;
  practice: PlannedTask;
  blocks: { condition: Condition; tasks: PlannedTask[] }[];
  transfer: PlannedTask;
}

export interface AdaptiveSignals {
  patchEvidence: PatchEvidence;
  staticWarnings: number;
  disagreement: boolean;
  uncertain: boolean;
  difficulty: 1 | 2 | 3;
  proficiency: Proficiency;
  recentUncritical: boolean;
}

export interface SupportPlan {
  condition: Condition | 'practice';
  level: SupportLevel | 'fixed' | 'none';
  activity: VerificationActivity;
  patchWithheld: boolean;
  showComparison: boolean;
  showEvidence: boolean;
  score: number | null;
  reasons: string[];
}

export interface TaskAttempt {
  id: string;
  participantId: string;
  isDemo: boolean;
  role: TaskRole;
  taskId: string;
  condition: Condition | null;
  block: number | null;
  indexInBlock: number;
  difficulty: number;
  bugType: string;
  aiCorrectness: Correctness | null;
  startedAt: string;
  diagnosisAt: string | null;
  adviceShownAt: string | null;
  verificationStartedAt: string | null;
  verificationDoneAt: string | null;
  decisionAt: string | null;
  submittedAt: string;
  completionMs: number;
  diagnosisText: string;
  suspectedLine: number | null;
  signals: AdaptiveSignals | null;
  support: SupportPlan | null;
  verificationAnswer: string | null;
  verificationCorrect: boolean | null;
  decision: Decision | null;
  decisionHistory: { decision: Decision; at: string }[];
  finalCode: string;
  finalMatchesPatch: boolean | null;
  visiblePassed: number;
  visibleTotal: number;
  hiddenPassed: number;
  hiddenTotal: number;
  finalCorrect: boolean;
  reliance: Reliance;
  codeRuns: number;
  testRuns: number;
  testRunsAfterAdvice: number;
  evidenceViews: number;
  edits: number;
}

export interface SurveyResponse {
  id: string;
  participantId: string;
  isDemo: boolean;
  kind: 'post_task' | 'post_condition' | 'final';
  condition: Condition | null;
  block: number | null;
  taskId: string | null;
  responses: Record<string, number | string>;
  scores: Record<string, number>;
  submittedAt: string;
}

export interface StudyEvent {
  id: string;
  participantId: string;
  isDemo: boolean;
  type: string;
  at: string;
  taskId: string | null;
  condition: Condition | null;
  payload: Record<string, unknown>;
}
