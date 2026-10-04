// This stable alias is verified against the project's existing API key. It can
// still be overridden with VITE_GEMINI_CLINICAL_SUMMARY_MODEL when needed.
const DEFAULT_MODEL = 'gemini-flash-latest'

const summarySchema = {
  type: 'OBJECT',
  properties: {
    caseMode: { type: 'STRING', enum: ['GENERAL', 'AYUSH'] },
    chiefComplaint: { type: 'STRING' },
    historyOfPresentIllness: { type: 'STRING' },
    symptoms: { type: 'ARRAY', items: { type: 'STRING' } },
    duration: { type: 'STRING' },
    severity: { type: 'STRING' },
    relevantNegativeFindings: { type: 'ARRAY', items: { type: 'STRING' } },
    medicalHistory: { type: 'ARRAY', items: { type: 'STRING' } },
    medications: { type: 'ARRAY', items: { type: 'STRING' } },
    allergies: { type: 'ARRAY', items: { type: 'STRING' } },
    investigations: { type: 'ARRAY', items: { type: 'STRING' } },
    reportFindings: { type: 'ARRAY', items: { type: 'STRING' } },
    redFlagSummary: { type: 'STRING' },
    importantPointsForDoctor: { type: 'ARRAY', items: { type: 'STRING' } },
    missingInformation: { type: 'ARRAY', items: { type: 'STRING' } },
    ayushContext: { type: 'ARRAY', items: { type: 'STRING' } },
    investigationData: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          testName: { type: 'STRING' },
          value: { type: 'NUMBER' },
          unit: { type: 'STRING' },
          referenceLow: { type: 'NUMBER', nullable: true },
          referenceHigh: { type: 'NUMBER', nullable: true },
          referenceText: { type: 'STRING' }
        },
        required: ['testName', 'value', 'unit', 'referenceLow', 'referenceHigh', 'referenceText']
      }
    },
    graphData: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          metric: { type: 'STRING' },
          unit: { type: 'STRING' },
          values: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { label: { type: 'STRING' }, value: { type: 'NUMBER' } },
              required: ['label', 'value']
            }
          }
        },
        required: ['metric', 'unit', 'values']
      }
    }
  },
  required: [
    'caseMode', 'chiefComplaint', 'historyOfPresentIllness', 'symptoms', 'duration',
    'severity', 'relevantNegativeFindings', 'medicalHistory', 'medications', 'allergies',
    'investigations', 'reportFindings', 'redFlagSummary', 'importantPointsForDoctor',
    'missingInformation', 'ayushContext', 'investigationData', 'graphData'
  ]
}

const asText = (value) => typeof value === 'string' ? value.trim() : ''
const stringList = (value) => Array.isArray(value)
  ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
  : []

const safeGraphData = (value, sourceText = '') => {
  const source = String(sourceText).toLowerCase()
  const isSupportedPoint = (point) => {
    const label = asText(point?.label).toLowerCase()
    const number = Number(point?.value)
    if (!label || !Number.isFinite(number) || !source) return false
    // Graph values are only trusted when the supplied source explicitly
    // contains both the measurement label and the numerical value.
    return source.includes(label) && source.includes(String(number).toLowerCase())
  }
  return Array.isArray(value)
  ? value.map((series) => ({
    metric: asText(series?.metric),
    unit: asText(series?.unit),
    values: Array.isArray(series?.values)
      ? series.values
        .filter(isSupportedPoint)
        .map((point) => ({ label: asText(point.label), value: Number(point.value) }))
      : []
  })).filter((series) => series.metric && series.values.length >= 2)
  : []
}

const sourceNumbers = (text) => new Set(
  String(text || '').match(/\d[\d,]*(?:\.\d+)?/g)?.map((number) => Number(number.replace(/,/g, '')).toString()) || []
)

const normalizedText = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
const normalizedUnit = (unit) => String(unit || '')
  .toLowerCase()
  .replace(/[µμ]/g, 'u')
  .replace(/[^a-z0-9]+/g, '')

// OCR often wraps a row of a laboratory table across adjacent lines. Keeping
// the evidence window local to the test name avoids accepting an unrelated
// value/range that merely appears somewhere else in the same report.
const reportEvidenceWindows = (report) => {
  const lines = String(report || '').replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  // A report row normally begins with its test label; include its next OCR
  // line for wrapped values/ranges, but not preceding/following rows. This
  // keeps a repeated number in a nearby test from validating a false value.
  return lines.map((_, index) => lines.slice(index, Math.min(lines.length, index + 2)).join(' '))
}

const testNameInEvidence = (testName, evidence) => {
  const normalizedName = normalizedText(testName)
  const normalizedEvidence = normalizedText(evidence)
  if (!normalizedName || !normalizedEvidence) return false
  if (normalizedEvidence.includes(normalizedName)) return true

  // A table may use a short row label such as "WBC" and the structured
  // response may use "WBC Count". Permit that only when every meaningful
  // (non-generic) token from the supplied test name is present in this row.
  const genericTokens = new Set(['count', 'test', 'level', 'serum', 'blood', 'total'])
  const meaningfulTokens = String(testName).toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length >= 2 && !genericTokens.has(token)) || []
  return meaningfulTokens.length > 0 && meaningfulTokens.every((token) => normalizedEvidence.includes(token))
}

const evidenceSupportsInvestigation = ({ testName, unit, numericValue, referenceLow, referenceHigh }, evidence) => {
  if (!testNameInEvidence(testName, evidence)) return false
  const evidenceNumbers = sourceNumbers(evidence)
  const requiredNumbers = [numericValue, ...(Number.isFinite(referenceLow) ? [referenceLow] : []), ...(Number.isFinite(referenceHigh) ? [referenceHigh] : [])]
  if (!requiredNumbers.every((number) => Number.isFinite(number) && evidenceNumbers.has(Number(number).toString()))) return false

  const requestedUnit = normalizedUnit(unit)
  return !requestedUnit || normalizedUnit(evidence).includes(requestedUnit)
}

const normalizeInvestigationData = (value, reportText = '') => {
  const report = String(reportText || '')
  if (!report.trim() || !Array.isArray(value)) return []
  const evidenceWindows = reportEvidenceWindows(report)

  return value.map((item) => {
    const testName = asText(item?.testName)
    const unit = asText(item?.unit)
    const referenceText = asText(item?.referenceText)
    const numericValue = Number(item?.value)
    const referenceLow = item?.referenceLow === null ? null : Number(item?.referenceLow)
    const referenceHigh = item?.referenceHigh === null ? null : Number(item?.referenceHigh)
    const hasLow = Number.isFinite(referenceLow)
    const hasHigh = Number.isFinite(referenceHigh)
    const referenceNumbersInText = [
      ...(hasLow ? [referenceLow] : []),
      ...(hasHigh ? [referenceHigh] : [])
    ].every((number) => referenceText && sourceNumbers(referenceText).has(Number(number).toString()))
    const hasReportEvidence = evidenceWindows.some((evidence) => evidenceSupportsInvestigation({
      testName,
      unit,
      numericValue,
      referenceLow: hasLow ? referenceLow : null,
      referenceHigh: hasHigh ? referenceHigh : null
    }, evidence))

    // A comparison is only displayed when one OCR evidence window explicitly
    // supports the test, value, unit and reference boundary. This allows
    // harmless spacing, dash and micro-symbol differences without accepting
    // unrelated numbers from elsewhere in the document.
    if (!hasReportEvidence || !referenceNumbersInText || (!hasLow && !hasHigh)) return null
    return { testName, value: numericValue, unit, referenceLow: hasLow ? referenceLow : null, referenceHigh: hasHigh ? referenceHigh : null, referenceText }
  }).filter(Boolean)
}

// Classifying a report-provided value is deterministic and is not a diagnosis.
export function classifyInvestigationValue({ value, referenceLow, referenceHigh } = {}) {
  if (!Number.isFinite(value)) return 'REFERENCE_RANGE_UNAVAILABLE'
  if (Number.isFinite(referenceLow) && value < referenceLow) return 'LOW'
  if (Number.isFinite(referenceHigh) && value > referenceHigh) return 'HIGH'
  if (Number.isFinite(referenceLow) || Number.isFinite(referenceHigh)) return 'NORMAL'
  return 'REFERENCE_RANGE_UNAVAILABLE'
}

// This is the single, de-identified input object sent to the clinical summarizer.
// Aadhaar, mobile number and other direct identifiers are intentionally excluded.
export function buildClinicalSummaryInput({
  patientInfo = {},
  caseMode,
  voiceConversation = [],
  voiceTranscript = '',
  manualAnswers = {},
  existingStructuredSummary = {},
  medicalReports = [],
  redFlagAssessment = {}
} = {}) {
  return {
    patientInfo: {
      age: patientInfo.age || 'Not reported',
      gender: patientInfo.gender || 'Not reported'
    },
    caseMode: String(caseMode || existingStructuredSummary.mode || 'GENERAL').toUpperCase() === 'AYUSH' ? 'AYUSH' : 'GENERAL',
    voiceConversation: Array.isArray(voiceConversation)
      ? voiceConversation
        .filter((message) => message && ['patient', 'assistant'].includes(message.type) && asText(message.text))
        .map((message) => ({ speaker: message.type, text: asText(message.text) }))
      : [],
    voiceTranscript: asText(voiceTranscript),
    manualAnswers: manualAnswers && typeof manualAnswers === 'object' ? manualAnswers : {},
    existingStructuredSummary: existingStructuredSummary && typeof existingStructuredSummary === 'object' ? existingStructuredSummary : {},
    medicalReports: Array.isArray(medicalReports)
      ? medicalReports.filter(Boolean).map((report) => ({
        fileName: asText(report.fileName) || 'Uploaded report',
        extractedText: asText(report.extractedText).slice(0, 12000)
      }))
      : [],
    redFlagAssessment: {
      detected: Boolean(redFlagAssessment?.detected),
      priority: asText(redFlagAssessment?.priority) || 'NORMAL',
      reasons: stringList(redFlagAssessment?.reasons),
      evidence: stringList(redFlagAssessment?.evidence),
      sources: stringList(redFlagAssessment?.sources)
    }
  }
}

export function normalizeClinicalSummary(value, fallbackMode = 'GENERAL', sourceText = '', reportText = '') {
  if (!value || typeof value !== 'object') return null
  const result = {
    caseMode: value.caseMode === 'AYUSH' ? 'AYUSH' : fallbackMode,
    chiefComplaint: asText(value.chiefComplaint) || 'Not reported',
    historyOfPresentIllness: asText(value.historyOfPresentIllness) || 'Not reported',
    symptoms: stringList(value.symptoms),
    duration: asText(value.duration) || 'Not reported',
    severity: asText(value.severity) || 'Not reported',
    relevantNegativeFindings: stringList(value.relevantNegativeFindings),
    medicalHistory: stringList(value.medicalHistory),
    medications: stringList(value.medications),
    allergies: stringList(value.allergies),
    investigations: stringList(value.investigations),
    reportFindings: stringList(value.reportFindings),
    redFlagSummary: asText(value.redFlagSummary) || 'Use the existing Red Flag assessment shown below.',
    importantPointsForDoctor: stringList(value.importantPointsForDoctor),
    missingInformation: stringList(value.missingInformation),
    ayushContext: stringList(value.ayushContext),
    investigationData: normalizeInvestigationData(value.investigationData, reportText),
    graphData: safeGraphData(value.graphData, sourceText)
  }
  return result
}

export async function generateClinicalSummary(clinicalInput, { signal } = {}) {
  const token = import.meta.env.VITE_GEMINI_LIVE_TOKEN
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!token && !apiKey) throw new Error('Gemini clinical summarization is not configured.')

  const model = import.meta.env.VITE_GEMINI_CLINICAL_SUMMARY_MODEL || DEFAULT_MODEL
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`
  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `Create an AI-assisted clinical summary from this de-identified patient data. Use only supplied facts. Preserve Hindi/Hinglish meaning. Do not diagnose, prescribe, invent symptoms, medications, allergies, negatives, history, test results, or report findings. Do not alter or reinterpret the supplied Red Flag assessment; summarize it only as supplied. Mark unknown facts as Not reported/Not available or list them in missingInformation. Report findings must come only from extracted report text. Extract investigationData ONLY when the report explicitly gives a test name, patient value, unit, and at least one reference boundary. Copy the supplied report range into referenceText. Never create or infer reference ranges. Use null for a missing side of a one-sided range. Return graphData as an empty array; investigation comparison is rendered separately from investigationData. This is a concise draft for physician review.\n\nPatient data:\n${JSON.stringify(clinicalInput)}` }]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: summarySchema,
        temperature: 0.1
      },
      systemInstruction: {
        parts: [{ text: 'You are a clinical documentation assistant. Return JSON matching the supplied schema only. You assist a physician; you do not diagnose or replace clinical judgement.' }]
      }
    })
  })

  if (!response.ok) throw new Error('Gemini clinical summarization was unavailable.')
  const payload = await response.json()
  const rawText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
  if (!rawText) throw new Error('Gemini clinical summarization returned no structured result.')

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error('Gemini clinical summarization returned invalid JSON.')
  }
  const sourceText = JSON.stringify({
    voiceConversation: clinicalInput.voiceConversation,
    voiceTranscript: clinicalInput.voiceTranscript,
    manualAnswers: clinicalInput.manualAnswers,
    existingStructuredSummary: clinicalInput.existingStructuredSummary,
    medicalReports: clinicalInput.medicalReports
  })
  const reportText = clinicalInput.medicalReports?.map((report) => report.extractedText || '').join('\n') || ''
  const normalized = normalizeClinicalSummary(parsed, clinicalInput.caseMode, sourceText, reportText)
  if (!normalized) throw new Error('Gemini clinical summarization did not match the expected schema.')
  return normalized
}
