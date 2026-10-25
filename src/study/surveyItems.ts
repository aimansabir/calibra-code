// Survey items only, no answer keys, so the browser can import this safely.

// Raw TLX (unweighted). Each item 0-100, performance is reversed on the scale
// so 0 = perfect, 100 = failure, which keeps "higher = more workload" for all six.
export const TLX_ITEMS = [
  { id: 'tlx_mental', label: 'Mental demand', question: 'How mentally demanding were the tasks in this part?', low: 'Very low', high: 'Very high' },
  { id: 'tlx_physical', label: 'Physical demand', question: 'How physically demanding were they?', low: 'Very low', high: 'Very high' },
  { id: 'tlx_temporal', label: 'Temporal demand', question: 'How hurried or rushed was the pace?', low: 'Very low', high: 'Very high' },
  { id: 'tlx_performance', label: 'Performance', question: 'How successful were you in doing what you were asked?', low: 'Perfect', high: 'Failure' },
  { id: 'tlx_effort', label: 'Effort', question: 'How hard did you have to work to reach your level of performance?', low: 'Very low', high: 'Very high' },
  { id: 'tlx_frustration', label: 'Frustration', question: 'How insecure, discouraged, irritated or stressed were you?', low: 'Very low', high: 'Very high' },
];

// Standard SUS wording with "system" replaced by "interface in this part".
export const SUS_ITEMS = [
  'I think that I would like to use this interface frequently.',
  'I found the interface unnecessarily complex.',
  'I thought the interface was easy to use.',
  'I think that I would need the support of a technical person to be able to use this interface.',
  'I found the various functions in this interface were well integrated.',
  'I thought there was too much inconsistency in this interface.',
  'I would imagine that most people would learn to use this interface very quickly.',
  'I found the interface very cumbersome to use.',
  'I felt very confident using the interface.',
  'I needed to learn a lot of things before I could get going with this interface.',
].map((text, i) => ({ id: `sus_${i + 1}`, text }));

export const AGENCY_ITEMS = [
  { id: 'agency_control', text: 'I felt in control of the final code I submitted.' },
  { id: 'agency_disagree', text: 'I felt able to disagree with the AI suggestion.' },
  { id: 'agency_confidence', text: 'I was confident in my decisions about the AI suggestions.' },
  { id: 'trust_ai', text: 'I trusted the AI suggestions in this part.' },
];

export const POST_TASK_ITEMS = [
  { id: 'confidence', text: 'How confident are you that your submitted code is correct?', low: 'Not at all', high: 'Completely', ai: false },
  { id: 'difficulty', text: 'How difficult was this task?', low: 'Very easy', high: 'Very difficult', ai: false },
  { id: 'helpfulness', text: 'How helpful was the AI suggestion?', low: 'Not helpful', high: 'Very helpful', ai: true },
  { id: 'effort', text: 'How much mental effort did this task take?', low: 'Very little', high: 'A great deal', ai: false },
];
