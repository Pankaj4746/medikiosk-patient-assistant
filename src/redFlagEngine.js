// Safety-screening helpers. These rules support triage only; they do not diagnose.

const PRIORITY_RANK = { NORMAL: 0, MEDIUM: 1, HIGH: 2 }

const unique = (values) => [...new Set(values.filter(Boolean))]

const textOf = (value) => String(value ?? '').toLowerCase()

const includesAny = (text, phrases) => {
  const normalizedText = textOf(text)
  return phrases.some((phrase) => normalizedText.includes(textOf(phrase)))
}

const isAffirmative = (value) => /^(yes|haan|ha|हाँ)$/i.test(String(value ?? '').trim())

const hasChestLanguage = (text) => includesAny(text, ['chest', 'seena', 'seene', 'सीना', 'सीने', 'छाती'])
const hasAbdominalLanguage = (text) => includesAny(text, ['abdominal', 'abdomen', 'stomach', 'pet', 'पेट'])
const hasBreathingLanguage = (text) => includesAny(text, [
  'difficulty breathing', 'trouble breathing', "can't breathe", 'cannot breathe',
  'unable to breathe', 'shortness of breath', 'saans nahi', 'saans lene mein dikkat', 'सांस'
])
const hasBloodLanguage = (text) => includesAny(text, [
  'vomited blood', 'blood vomit', 'blood vomiting', 'blood in vomit', 'hematemesis',
  'खून की उल्टी', 'khoon ki ulti'
])
const hasHeavyBleedingLanguage = (text) => includesAny(text, [
  'heavy bleeding', 'severe bleeding', 'significant bleeding', 'bahut khoon', 'बहुत खून'
])
const hasLossOfConsciousnessLanguage = (text) => includesAny(text, [
  'unconscious', 'loss of consciousness', 'passed out', 'fainting', 'बेहोश', 'बेहोशी'
])
const hasVerySevereLanguage = (text) => includesAny(text, [
  'very severe', 'extremely severe', 'unbearable', 'bahut tez', 'bahut zyada dard', 'बहुत तेज'
])
const hasRepeatedVomitingLanguage = (text) => includesAny(text, [
  'repeated vomiting', 'vomiting repeatedly', 'vomiting many times', 'multiple episodes of vomiting', 'baar baar ulti', 'बार बार उल्टी'
])

export function createEmptyRedFlagResult() {
  return {
    detected: false,
    priority: 'NORMAL',
    reasons: [],
    evidence: [],
    ruleDetected: false,
    aiDetected: false,
    sources: [],
    aiAssessmentStatus: 'NOT_REQUESTED'
  }
}

// Accepts structured manual answers and/or a natural-language transcript.
export function evaluateRedFlags(patientData = {}) {
  const answers = patientData.answers || {}
  const summary = patientData.summary || {}
  const transcript = patientData.transcript || ''
  const complaint = answers.complaint || summary.complaint || ''
  const severity = answers.severity || summary.severity || ''
  const temperature = answers.temperature || ''
  const breathing = answers.breathing || ''
  const sweating = answers.sweating || ''
  const vomiting = answers.vomiting || ''
  const associated = [answers.symptoms, answers.other, summary.associated].filter(Boolean).join(' ')
  const allText = [complaint, severity, temperature, breathing, sweating, vomiting, associated, transcript].join(' ').toLowerCase()
  const reasons = []
  const evidence = []
  let priority = 'NORMAL'

  const flag = (nextPriority, reason, supportingEvidence) => {
    if (PRIORITY_RANK[nextPriority] > PRIORITY_RANK[priority]) priority = nextPriority
    reasons.push(reason)
    if (supportingEvidence) evidence.push(supportingEvidence)
  }

  if (hasLossOfConsciousnessLanguage(allText)) {
    flag('HIGH', 'Loss of consciousness or fainting reported', 'Patient information mentions unconsciousness or fainting.')
  }
  if (hasBloodLanguage(allText)) {
    flag('HIGH', 'Blood in vomit reported', 'Patient information mentions blood with vomiting.')
  }
  if (hasHeavyBleedingLanguage(allText)) {
    flag('HIGH', 'Significant bleeding reported', 'Patient information mentions heavy or severe bleeding.')
  }
  if (hasBreathingLanguage(allText) && !hasChestLanguage(allText)) {
    flag('HIGH', 'Severe breathing difficulty reported', 'Patient information mentions inability or significant difficulty breathing.')
  }

  const chestComplaint = hasChestLanguage(complaint) || hasChestLanguage(transcript)
  const breathingDifficulty = isAffirmative(breathing) || hasBreathingLanguage(transcript)
  const verySeverePain = hasVerySevereLanguage(severity) || hasVerySevereLanguage(transcript)
  const abdominalComplaint = hasAbdominalLanguage(complaint) || hasAbdominalLanguage(transcript)
  const vomitingReported = isAffirmative(vomiting) || hasRepeatedVomitingLanguage(transcript)
  const repeatedVomiting = hasRepeatedVomitingLanguage(transcript)

  if (chestComplaint && breathingDifficulty) {
    flag('HIGH', 'Chest complaint associated with breathing difficulty', 'Chest symptoms and breathing difficulty were both reported.')
  }
  if (chestComplaint && verySeverePain) {
    flag('HIGH', 'Very severe chest pain reported', 'Chest symptoms were reported with very severe pain.')
  }
  if (chestComplaint && isAffirmative(sweating)) {
    flag('MEDIUM', 'Chest complaint associated with a concerning sweating or dizziness response', 'The questionnaire response indicated unusual sweating or dizziness with chest symptoms.')
  }
  if (abdominalComplaint && verySeverePain && (vomitingReported || hasBloodLanguage(allText))) {
    flag('HIGH', 'Very severe abdominal pain with concerning vomiting or bleeding', 'Abdominal pain was reported with very severe severity and vomiting or bleeding.')
  } else if (verySeverePain && repeatedVomiting) {
    flag('HIGH', 'Very severe pain with repeated vomiting', 'Very severe pain and repeated vomiting were both reported.')
  }

  // The questionnaire itself uses "Above 104°F" as its highest temperature option.
  if (/above\s*104|(?:^|\D)(10[5-9]|1[1-9]\d|[2-9]\d{2,})(?:\D|$)/.test(textOf(temperature))) {
    flag('HIGH', 'Very high fever reported', `Temperature response: ${temperature}`)
  }

  return {
    detected: reasons.length > 0,
    priority,
    reasons: unique(reasons),
    evidence: unique(evidence),
    ruleDetected: reasons.length > 0,
    aiDetected: false,
    sources: reasons.length > 0 ? ['RULE_ENGINE'] : [],
    aiAssessmentStatus: 'NOT_REQUESTED'
  }
}

export function normalizeAiRedFlagAssessment(value) {
  if (!value || typeof value !== 'object' || typeof value.detected !== 'boolean') return null
  const priority = ['NORMAL', 'MEDIUM', 'HIGH'].includes(value.priority) ? value.priority : (value.detected ? 'MEDIUM' : 'NORMAL')
  const reasons = Array.isArray(value.reasons) ? value.reasons.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : []
  const evidence = Array.isArray(value.evidence) ? value.evidence.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : []
  // A positive AI result without a patient-supported explanation is not useful
  // or auditable, so treat it as malformed rather than displaying a vague alert.
  if (value.detected && (reasons.length === 0 || evidence.length === 0)) return null
  return { detected: value.detected, priority, reasons: unique(reasons), evidence: unique(evidence) }
}

export function combineRedFlagResults(ruleResult, aiResult, aiAssessmentStatus = 'COMPLETED') {
  const rules = ruleResult || createEmptyRedFlagResult()
  const ai = normalizeAiRedFlagAssessment(aiResult)
  const detected = Boolean(rules.detected || ai?.detected)
  const priority = PRIORITY_RANK[ai?.priority || 'NORMAL'] > PRIORITY_RANK[rules.priority || 'NORMAL']
    ? ai.priority
    : (rules.priority || 'NORMAL')
  return {
    detected,
    priority: detected && priority === 'NORMAL' ? 'MEDIUM' : priority,
    reasons: unique([...(rules.reasons || []), ...(ai?.detected ? ai.reasons : [])]),
    evidence: unique([...(rules.evidence || []), ...(ai?.detected ? ai.evidence : [])]),
    ruleDetected: Boolean(rules.detected),
    aiDetected: Boolean(ai?.detected),
    sources: unique([...(rules.detected ? ['RULE_ENGINE'] : []), ...(ai?.detected ? ['GEMINI_AI'] : [])]),
    aiAssessmentStatus: ai ? aiAssessmentStatus : 'UNAVAILABLE'
  }
}
