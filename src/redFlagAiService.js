import { normalizeAiRedFlagAssessment } from './redFlagEngine'

const DEFAULT_MODEL = 'gemini-2.5-flash'

const assessmentSchema = {
  type: 'OBJECT',
  properties: {
    detected: { type: 'BOOLEAN' },
    priority: { type: 'STRING', enum: ['NORMAL', 'MEDIUM', 'HIGH'] },
    reasons: { type: 'ARRAY', items: { type: 'STRING' } },
    evidence: { type: 'ARRAY', items: { type: 'STRING' } }
  },
  required: ['detected', 'priority', 'reasons', 'evidence']
}

// Uses the same environment credentials already used by Gemini Live. Any failure
// is deliberately returned to the caller so deterministic rules remain available.
export async function assessTranscriptRedFlags(transcript) {
  const text = String(transcript || '').trim()
  if (!text) throw new Error('No patient transcript is available for assessment.')

  const token = import.meta.env.VITE_GEMINI_LIVE_TOKEN
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!token && !apiKey) throw new Error('Gemini assessment is not configured.')

  const model = import.meta.env.VITE_GEMINI_REDFLAG_MODEL || DEFAULT_MODEL
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent${apiKey ? `?key=${encodeURIComponent(apiKey)}` : ''}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: `Assess this patient-provided clinical history only for immediate safety/triage warning signs. Do not diagnose, prescribe, infer missing facts, or add reasons that are not explicitly supported. Mark NORMAL unless a clinically meaningful warning pattern is explicitly reported.\n\nPatient history:\n${text}` }]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: assessmentSchema,
        temperature: 0
      },
      systemInstruction: {
        parts: [{ text: 'You are a safety-screening assistant. Return only JSON that matches the supplied schema. This is triage support, not a diagnosis.' }]
      }
    })
  })

  if (!response.ok) throw new Error('Gemini safety assessment was unavailable.')
  const payload = await response.json()
  const rawText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim()
  if (!rawText) throw new Error('Gemini safety assessment returned no structured result.')

  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new Error('Gemini safety assessment returned invalid JSON.')
  }
  const normalized = normalizeAiRedFlagAssessment(parsed)
  if (!normalized) throw new Error('Gemini safety assessment did not match the expected schema.')
  return normalized
}
