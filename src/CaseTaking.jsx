import { useEffect, useRef, useState } from 'react'
import { GeminiLiveService } from './geminiLiveService'
import { combineRedFlagResults, createEmptyRedFlagResult, evaluateRedFlags } from './redFlagEngine'
import { assessTranscriptRedFlags } from './redFlagAiService'

function CaseTaking({
  patient,
  onBack,
  onReportUpload,
  onCaseComplete,
  initialSummary,
  initialRedFlag,
  initialRedFlagAssessment,
  showFinalSummary,
  caseMode,
  onCaseModeChange,
  onConsentComplete,
  initialShowConsent,
  onSendToDoctor
}) {
  const [step, setStep] = useState(0)
  const [answer, setAnswer] = useState('')
  const [answers, setAnswers] = useState({})
  const [messages, setMessages] = useState([])
  const [listening, setListening] = useState(false)
  const [finished, setFinished] = useState(false)
  const [redFlag, setRedFlag] = useState(false)
  const [redFlagAssessment, setRedFlagAssessment] = useState(createEmptyRedFlagResult)
  const [showReportQuestion, setShowReportQuestion] = useState(false)
  const [consentGiven, setConsentGiven] = useState(false)
  const [showConsent, setShowConsent] = useState(initialShowConsent || false)
  const [showSendConfirmation, setShowSendConfirmation] = useState(false)
  const liveAssistantRef = useRef(null)
  const [voiceStatus, setVoiceStatus] = useState(
    GeminiLiveService.isConfigured() ? '' : 'Gemini voice needs setup'
  )
  const [voiceCaption, setVoiceCaption] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [naturalConversation, setNaturalConversation] = useState([])
  const [naturalStarted, setNaturalStarted] = useState(false)

  const [questions, setQuestions] = useState([
    {
      id: 'complaint',
      question: 'Aapko sabse zyada kis problem ki wajah se consultation chahiye?',
      type: 'text',
      placeholder: 'Apni problem yahan batayein...'
    }
  ])

  const addMessage = (type, text) => {
    setMessages((prev) => [
      ...prev,
      { type, text }
    ])
  }

  const assessClinicalSafety = async ({ caseAnswers = {}, summary, transcript = '' }) => {
    const ruleResult = evaluateRedFlags({ answers: caseAnswers, summary, transcript, mode: caseMode })
    const assessmentText = transcript || Object.entries(caseAnswers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n')

    if (!assessmentText.trim() || !GeminiLiveService.isConfigured()) {
      return combineRedFlagResults(ruleResult, null, 'NOT_CONFIGURED')
    }

    try {
      const aiResult = await assessTranscriptRedFlags(assessmentText)
      return combineRedFlagResults(ruleResult, aiResult, 'COMPLETED')
    } catch {
      // The deterministic engine is intentionally still used when Gemini is unavailable.
      console.warn('AI safety assessment unavailable; deterministic safety rules were used.')
      return combineRedFlagResults(ruleResult, null, 'FAILED')
    }
  }

  const completeCase = async ({ summary, caseAnswers = {}, transcript = '', voiceConversation = [] }) => {
    const assessment = await assessClinicalSafety({ caseAnswers, summary, transcript })
    setRedFlagAssessment(assessment)
    setRedFlag(assessment.detected)
    onCaseComplete?.({
      summary,
      redFlag: assessment.detected,
      redFlagAssessment: assessment,
      clinicalData: {
        caseMode: summary.mode,
        voiceConversation,
        voiceTranscript: transcript,
        manualAnswers: caseAnswers
      }
    })
    setShowReportQuestion(true)
  }

  useEffect(() => () => liveAssistantRef.current?.disconnect(), [])

  const addNaturalMessage = (type, text) => {
    if (!text?.trim()) return
    setNaturalConversation((previous) => {
      const last = previous[previous.length - 1]
      if (last?.type === type) {
        return [...previous.slice(0, -1), { ...last, text: `${last.text}${text}` }]
      }
      return [...previous, { type, text }]
    })
  }

  const startNaturalConversation = async () => {
  setVoiceError('')
  setVoiceCaption('')
  setNaturalConversation([])
  setVoiceStatus('Connecting to Gemini…')

  try {
    liveAssistantRef.current?.disconnect()

    liveAssistantRef.current = new GeminiLiveService({
      onStatus: setVoiceStatus,

      onPatientTranscript: (text) => addNaturalMessage('patient', text),

      onAssistantTranscript: (text) => {
        setVoiceCaption(text)
        addNaturalMessage('assistant', text)
      },

      onError: (message) => setVoiceError(message)
    })

    await liveAssistantRef.current.connect()

    liveAssistantRef.current.sendText(
      `Start a natural spoken clinical history interview for ${patient.name || 'the patient'}. Greet them warmly. Ask only the single most important opening question: what problem brought them in today? Then wait for their voice response. Continue with short, doctor-like follow-up questions based only on their answers. Do not use a questionnaire, list multiple questions, diagnose, prescribe, or mention technical AI details.`
    )

    setNaturalStarted(true)
    setVoiceStatus('Gemini is ready. Listen to the question, then speak naturally.')
  } catch (error) {
    const message =
      error?.message ||
      'Gemini voice could not start. Please try again.'

    setVoiceError(message)
    setVoiceStatus('Voice assistant unavailable')
  }
}

  const finishNaturalConversation = async () => {
    liveAssistantRef.current?.stopMicrophone()
    setListening(false)
    const spokenHistory = naturalConversation
      .filter((message) => message.type === 'patient')
      .map((message) => message.text)
      .join(' ')

    const summary = {
      mode: 'General',
      complaint: spokenHistory || 'Voice history recorded; clinician to review.',
      duration: 'Discussed during natural voice interview',
      location: 'To be reviewed by clinician',
      severity: 'To be reviewed by clinician',
      associated: 'Full patient voice history is available in the conversation transcript.'
    }

    await completeCase({ summary, transcript: spokenHistory, voiceConversation: naturalConversation })
  }

  const startGeminiVoice = async (question = questions[step]?.question) => {
    setVoiceError('')
    try {
      if (!liveAssistantRef.current) {
        liveAssistantRef.current = new GeminiLiveService({
          onStatus: setVoiceStatus,
          onPatientTranscript: (text) => setAnswer(text),
          onAssistantTranscript: (text) => setVoiceCaption(text),
          onError: (message) => setVoiceError(message)
        })
        await liveAssistantRef.current.connect()
      }
      setVoiceCaption('')
      liveAssistantRef.current.ask(question)
      setVoiceStatus('Gemini is asking the question…')
    } catch (error) {
      setVoiceError(error.message || 'Gemini voice could not start.')
      setVoiceStatus('Voice assistant unavailable')
    }
  }

  const toggleGeminiMicrophone = async () => {
    try {
      if (!liveAssistantRef.current) {
        await startGeminiVoice()
        return
      }
      if (!liveAssistantRef.current) return
      if (listening) {
        liveAssistantRef.current.stopMicrophone()
        setListening(false)
        setVoiceStatus('Your answer is ready to review')
      } else {
        await liveAssistantRef.current.startMicrophone()
        setListening(true)
        setVoiceStatus('Listening to your answer…')
      }
    } catch (error) {
      setVoiceError(error.message || 'Microphone could not start.')
      setListening(false)
    }
  }

  const detectComplaint = (text) => {
  const value = text.toLowerCase()

  // Chest related
  if (
    value.includes('chest') ||
    value.includes('chest pain') ||
    value.includes('seena') ||
    value.includes('seene') ||
    value.includes('सीना') ||
    value.includes('सीने') ||
    value.includes('छाती') ||
    value.includes('chest mein') ||
    value.includes('seene mein') ||
    value.includes('seene me')
  ) {
    return 'chest'
  }

  // Fever related
  if (
    value.includes('fever') ||
    value.includes('bukhar') ||
    value.includes('बुखार') ||
    value.includes('temperature')
  ) {
    return 'fever'
  }

  // Abdominal / stomach related
  if (
    value.includes('stomach') ||
    value.includes('stomach pain') ||
    value.includes('pet') ||
    value.includes('pet mein') ||
    value.includes('pet me') ||
    value.includes('पेट')
  ) {
    return 'abdominal'
  }

  return 'general'
}

  const getFollowUpQuestions = (complaint) => {

  // ==============================
  // AYUSH CASE TAKING
  // ==============================
  if (caseMode === 'ayush') {
    return [
      {
        id: 'duration',
        question: 'Ye problem kab se hai?',
        type: 'options',
        options: [
          'Aaj se',
          '2–7 din',
          '1–4 weeks',
          '1 month se zyada'
        ]
      },

      {
        id: 'agni',
        question: 'Aapki bhookh aur digestion kaisa rehta hai?',
        type: 'options',
        options: [
          'Normal',
          'Bhookh kam lagti hai',
          'Bhookh bahut zyada lagti hai',
          'Kabhi kam kabhi zyada'
        ]
      },

      {
        id: 'digestion',
        question: 'Khane ke baad digestion se related koi problem hoti hai?',
        type: 'options',
        options: [
          'Koi problem nahi',
          'Gas / bloating',
          'Acidity / burning',
          'Heavy feeling',
          'Indigestion'
        ]
      },

      {
        id: 'sleep',
        question: 'Aapki neend kaisi rehti hai?',
        type: 'options',
        options: [
          'Achhi aur regular',
          'Neend aane mein dikkat',
          'Raat mein baar-baar neend khulti hai',
          'Neend kam hoti hai',
          'Bahut zyada neend aati hai'
        ]
      },

      {
        id: 'diet',
        question: 'Aapka daily diet aur khane ka routine kaisa hai?',
        type: 'options',
        options: [
          'Regular aur balanced',
          'Meals irregular hain',
          'Spicy / oily food zyada',
          'Outside / processed food zyada',
          'Mixed / varies daily'
        ]
      },

      {
        id: 'bowel',
        question: 'Aapki bowel habit / motion kaisi rehti hai?',
        type: 'options',
        options: [
          'Regular',
          'Constipation',
          'Loose motion',
          'Kabhi constipation kabhi loose',
          'Other'
        ]
      },

      {
        id: 'urination',
        question: 'Aapki urination / urine habit mein koi dikkat hai?',
        type: 'options',
        options: [
          'Koi problem nahi',
          'Urination zyada hota hai',
          'Urination kam hota hai',
          'Burning / discomfort',
          'Other'
        ]
      },

      {
        id: 'lifestyle',
        question: 'Aapka daily lifestyle aur physical activity kaisa hai?',
        type: 'options',
        options: [
          'Regular exercise / active',
          'Light activity',
          'Mostly sitting / sedentary',
          'Irregular routine',
          'Very physically active'
        ]
      },

      {
        id: 'stress',
        question: 'Aapki current mental state aur stress level kaisa hai?',
        type: 'options',
        options: [
          'Relaxed',
          'Mild stress',
          'Moderate stress',
          'High stress',
          'Frequently anxious / disturbed'
        ]
      },

      {
        id: 'treatment',
        question: 'Kya aap currently koi medicine ya treatment le rahe hain?',
        type: 'options',
        options: [
          'No',
          'Yes - prescribed medicine',
          'Yes - AYUSH medicine',
          'Yes - both',
          'Not sure'
        ]
      }
    ]
  }

  // ==============================
  // EXISTING GENERAL CASE TAKING
  // ==============================

  if (complaint === 'chest') {
      return [
        {
          id: 'onset',
          question: 'Seene mein dard kab se ho raha hai?',
          type: 'options',
          options: ['Aaj se', '2–7 din', '1–4 weeks', '1 month se zyada']
        },
        {
          id: 'location',
          question: 'Dard seene ke kis area mein hai?',
          type: 'options',
          options: ['Center', 'Left side', 'Right side', 'Pura chest']
        },
        {
          id: 'severity',
          question: 'Dard kitna severe hai?',
          type: 'options',
          options: ['Mild', 'Moderate', 'Severe', 'Very severe']
        },
        {
          id: 'breathing',
          question: 'Kya aapko saans lene mein dikkat ho rahi hai?',
          type: 'options',
          options: ['Yes', 'No']
        },
        {
          id: 'sweating',
          question: 'Kya unusual sweating ya chakkar aa raha hai?',
          type: 'options',
          options: ['Yes', 'No']
        }
      ]
    }

    if (complaint === 'fever') {
      return [
        {
          id: 'duration',
          question: 'Bukhar kab se hai?',
          type: 'options',
          options: ['Aaj se', '2–3 din', '4–7 din', '1 week se zyada']
        },
        {
          id: 'temperature',
          question: 'Agar temperature measure kiya hai, to approximately kitna tha?',
          type: 'options',
          options: ['Below 100°F', '100–102°F', '102–104°F', 'Above 104°F', 'Not measured']
        },
        {
          id: 'symptoms',
          question: 'Bukhar ke saath aur kya symptoms hain?',
          type: 'options',
          options: ['Cough', 'Body pain', 'Headache', 'Vomiting', 'None']
        },
        {
          id: 'breathing',
          question: 'Kya saans lene mein dikkat ho rahi hai?',
          type: 'options',
          options: ['Yes', 'No']
        }
      ]
    }

    if (complaint === 'abdominal') {
      return [
        {
          id: 'duration',
          question: 'Pet mein dard kab se hai?',
          type: 'options',
          options: ['Aaj se', '2–7 din', '1–4 weeks', '1 month se zyada']
        },
        {
          id: 'location',
          question: 'Pet ke kis hisse mein dard hai?',
          type: 'options',
          options: ['Upper', 'Lower', 'Right side', 'Left side', 'Entire abdomen']
        },
        {
          id: 'severity',
          question: 'Dard kitna severe hai?',
          type: 'options',
          options: ['Mild', 'Moderate', 'Severe', 'Very severe']
        },
        {
          id: 'vomiting',
          question: 'Kya vomiting ya nausea ho raha hai?',
          type: 'options',
          options: ['Yes', 'No']
        },
        {
          id: 'food',
          question: 'Kya khane ke baad dard badhta hai?',
          type: 'options',
          options: ['Yes', 'No', 'Not sure']
        }
      ]
    }

    return [
      {
        id: 'duration',
        question: 'Ye problem kab se hai?',
        type: 'options',
        options: ['Aaj se', '2–7 din', '1–4 weeks', '1 month se zyada']
      },
      {
        id: 'severity',
        question: 'Problem kitni severe hai?',
        type: 'options',
        options: ['Mild', 'Moderate', 'Severe', 'Very severe']
      },
      {
        id: 'other',
        question: 'Kya iske saath koi aur symptom bhi hai?',
        type: 'text',
        placeholder: 'Additional symptoms batayein...'
      }
    ]
  }

  const submitAnswer = async (selectedAnswer = null) => {
    const finalAnswer = selectedAnswer || answer.trim()

    if (!finalAnswer) return

    const currentQuestion = questions[step]

    addMessage('patient', finalAnswer)

    const updatedAnswers = {
      ...answers,
      [currentQuestion.id]: finalAnswer
    }

    setAnswers(updatedAnswers)
    setAnswer('')

    if (currentQuestion.id === 'complaint') {
      const complaint = detectComplaint(finalAnswer)
      const followUps = getFollowUpQuestions(complaint)

      setQuestions([
        currentQuestion,
        ...followUps
      ])

      setTimeout(() => {
        addMessage('ai', followUps[0].question)
      }, 300)

      if (liveAssistantRef.current) {
        window.setTimeout(() => startGeminiVoice(followUps[0].question), 700)
      }

      setStep(1)
      return
    }

    if (step < questions.length - 1) {
      const nextQuestion = questions[step + 1]

      setTimeout(() => {
        addMessage('ai', nextQuestion.question)
      }, 250)

      if (liveAssistantRef.current) {
        window.setTimeout(() => startGeminiVoice(nextQuestion.question), 650)
      }

      setStep(step + 1)
    } else {

  let finalSummary

if (caseMode === 'ayush') {
  finalSummary = {
    mode: 'AYUSH',
    complaint: updatedAnswers.complaint || 'Not provided',
    duration: updatedAnswers.duration || 'Not provided',
    agni: updatedAnswers.agni || 'Not provided',
    digestion: updatedAnswers.digestion || 'Not provided',
    sleep: updatedAnswers.sleep || 'Not provided',
    diet: updatedAnswers.diet || 'Not provided',
    bowel: updatedAnswers.bowel || 'Not provided',
    urination: updatedAnswers.urination || 'Not provided',
    lifestyle: updatedAnswers.lifestyle || 'Not provided',
    stress: updatedAnswers.stress || 'Not provided',
    treatment: updatedAnswers.treatment || 'Not provided'
  }
} else {
  finalSummary = {
    mode: 'General',
    complaint: updatedAnswers.complaint || 'Not provided',
    duration:
      updatedAnswers.duration ||
      updatedAnswers.onset ||
      'Not provided',
    location: updatedAnswers.location || 'Not provided',
    severity: updatedAnswers.severity || 'Not provided',
    associated:
      updatedAnswers.symptoms ||
      updatedAnswers.vomiting ||
      updatedAnswers.other ||
      'None reported'
  }
}

  // React state has not committed the final addMessage call yet. Preserve that
  // final answer in the immutable snapshot supplied to clinical summarization.
  const finalConversation = messages[messages.length - 1]?.type === 'patient' && messages[messages.length - 1]?.text === finalAnswer
    ? messages
    : [...messages, { type: 'patient', text: finalAnswer }]
  await completeCase({ summary: finalSummary, caseAnswers: updatedAnswers, voiceConversation: finalConversation })
}
  }

  const startVoiceInput = () => {
  if (caseMode === 'natural' && GeminiLiveService.isConfigured()) {
    toggleGeminiMicrophone()
    return
  }

  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition

  if (!SpeechRecognition) {
    alert(
      'Speech recognition is not supported in this browser.'
    )
    return
  }

  const recognition = new SpeechRecognition()

  // Indian English works better for Hinglish
  recognition.lang = 'en-IN'

  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 3

  recognition.onstart = () => {
    console.log('🎙️ Voice recognition started')
    setListening(true)
  }

  recognition.onspeechstart = () => {
    console.log('🗣️ Speech detected')
  }

  recognition.onresult = (event) => {
    console.log('✅ Speech result received', event)

    let transcript = ''

    for (
      let i = event.resultIndex;
      i < event.results.length;
      i++
    ) {
      transcript += event.results[i][0].transcript
    }

    console.log('📝 Transcript:', transcript)

    if (transcript.trim()) {
      setAnswer(transcript)
    }
  }

  recognition.onspeechend = () => {
    console.log('🛑 Speech ended')
  }

  recognition.onerror = (event) => {
    console.error(
      '❌ Speech recognition error:',
      event.error
    )

    setListening(false)

    if (event.error === 'not-allowed') {
      alert(
        'Microphone permission denied. Please allow microphone access.'
      )
    }

    else if (event.error === 'no-speech') {
      alert(
        'Voice detect nahi hui. Please Speak button dabakar 2-3 seconds clearly boliye.'
      )
    }

    else if (event.error === 'audio-capture') {
      alert(
        'Microphone access nahi mil raha. Please check your microphone.'
      )
    }

    else if (event.error === 'network') {
      alert(
        'Speech recognition ke liye network connection required hai.'
      )
    }

    else {
      alert(
        'Voice recognition mein problem aayi. Please dobara try karein.'
      )
    }
  }

  recognition.onend = () => {
    console.log('🔚 Voice recognition ended')
    setListening(false)
  }

  try {
    recognition.start()
  } catch (error) {
    console.error('Recognition start error:', error)
    setListening(false)
  }
}

  const getSummary = () => {

  if (caseMode === 'ayush') {
    return {
      mode: 'AYUSH',
      complaint: answers.complaint || 'Not provided',
      duration: answers.duration || 'Not provided',
      agni: answers.agni || 'Not provided',
      digestion: answers.digestion || 'Not provided',
      sleep: answers.sleep || 'Not provided',
      diet: answers.diet || 'Not provided',
      bowel: answers.bowel || 'Not provided',
      urination: answers.urination || 'Not provided',
      lifestyle: answers.lifestyle || 'Not provided',
      stress: answers.stress || 'Not provided',
      treatment: answers.treatment || 'Not provided'
    }
  }

  return {
    mode: 'General',
    complaint: answers.complaint || 'Not provided',
    duration:
      answers.duration ||
      answers.onset ||
      'Not provided',
    location:
      answers.location ||
      'Not provided',
    severity:
      answers.severity ||
      'Not provided',
    associated:
      answers.symptoms ||
      answers.vomiting ||
      answers.other ||
      'None reported'
  }
}

  const finalDisplaySummary = initialSummary || getSummary()
  const finalDisplayRedFlagAssessment = initialRedFlagAssessment || redFlagAssessment
  const finalDisplayRedFlag = Boolean(initialRedFlag || finalDisplayRedFlagAssessment.detected || redFlag)

if (!caseMode) {
  return (
    <div className="patient-page">

      <div className="patient-header">

        <button
          className="back-button"
          onClick={onBack}
        >
          ← Exit
        </button>

        <div className="patient-logo">
          <div className="logo-icon">✚</div>
          <span>MediKiosk</span>
        </div>

        <div className="header-spacer"></div>

      </div>

      <div className="case-taking-container">

        <div className="case-top">
          <div className="badge">
            ✦ PATIENT CASE TAKING
          </div>
        </div>

        <div className="mode-selection">

          <div className="mode-selection-header">

            <span className="eyebrow">CHOOSE HOW YOU WANT TO TALK</span>

            <h1>
              How would you like to share your history?
            </h1>

            <p>
              Choose natural conversation for Gemini voice assistance, or
              smart questions for a simple guided form.
            </p>

          </div>

          <div className="case-mode-grid">

            <button
              className="case-mode-card natural-speaking-mode"
              onClick={() => onCaseModeChange('natural')}
            >

              <div className="case-mode-icon">
                🎙️
              </div>

              <h2>Natural Speaking</h2>

              <p>
                Speak freely with Gemini. It asks one focused, doctor-like
                follow-up question at a time.
              </p>

              <span className="mode-action">
                Start voice conversation →
              </span>

            </button>

            <button
              className="case-mode-card"
              onClick={() => onCaseModeChange('general')}
            >
              <div className="case-mode-icon">🧠</div>

              <h2>Smart Questions</h2>

              <p>
                Answer short follow-up questions by tapping options or typing.
                Gemini voice is not used in this method.
              </p>

              <span className="mode-action">
                Start smart questions →
              </span>
            </button>

          </div>

        </div>

      </div>

    </div>
  )
}

if (caseMode === 'natural' && !showReportQuestion && !showConsent) {
  return (
    <div className="patient-page">
      <div className="patient-header">
        <button className="back-button" onClick={onBack}>← Exit</button>
        <div className="patient-logo"><div className="logo-icon">✚</div><span>MediKiosk</span></div>
        <div className="header-spacer"></div>
      </div>

      <main className="natural-speaking-container">
        <div className="natural-speaking-heading">
          <span className="badge">✦ NATURAL SPEAKING</span>
          <h1>Speak naturally.<br /><span>We will listen.</span></h1>
          
        </div>

        <section className="natural-speaking-card" aria-live="polite">
          <div className="natural-speaking-status">
            <span className={`natural-status-dot ${listening ? 'listening' : ''}`}></span>
            <div><strong>Gemini voice interview</strong><p>{voiceStatus}</p></div>
          </div>

          {!naturalStarted ? (
            <div className="natural-start-panel">
              <div className="natural-mic-icon">🎙️</div>
              <h2>Ready to tell us in your own words?</h2>
              
              <button className="natural-primary-button" onClick={startNaturalConversation}>
                Start natural conversation →
              </button>
              {!GeminiLiveService.isConfigured() && <p className="natural-setup-note">Gemini needs an API key in <code>.env.local</code> before voice conversation can start.</p>}
            </div>
          ) : (
            <>
              <div className="natural-transcript" aria-label="Voice conversation transcript">
                {naturalConversation.length === 0 ? (
                  <div className="natural-waiting"><span>🔊</span><p>Gemini is preparing its first question…</p></div>
                ) : naturalConversation.map((message, index) => (
                  <article className={`natural-message ${message.type}`} key={`${message.type}-${index}`}>
                    <span>{message.type === 'assistant' ? 'MediKiosk' : 'You'}</span>
                    <p>{message.text}</p>
                  </article>
                ))}
              </div>

              {voiceCaption && <div className="natural-current-question"><strong>Gemini is asking:</strong><p>{voiceCaption}</p></div>}
              {voiceError && <div className="gemini-voice-error" role="alert">{voiceError}</div>}

              <div className="natural-actions">
                <button className={`natural-record-button ${listening ? 'recording' : ''}`} onClick={toggleGeminiMicrophone}>
                  <span>{listening ? '■' : '🎙️'}</span>
                  {listening ? 'Finish speaking' : 'Speak now'}
                </button>
                <p>{listening ? 'Speak in Hindi, English, or Hinglish. Press again when you are finished.' : 'Wait for Gemini’s question, then press Speak now to answer.'}</p>
              </div>
              <button className="natural-finish-button" onClick={finishNaturalConversation} disabled={!naturalConversation.some((message) => message.type === 'patient')}>
                I have finished telling my history →
              </button>
            </>
          )}
        </section>
      </main>
    </div>
  )
}

if (showReportQuestion) {
  return (
    <div className="patient-page">

      <div className="patient-header">

        <button
          className="back-button"
          onClick={onBack}
        >
          ← Exit
        </button>

        <div className="patient-logo">
          <div className="logo-icon">✚</div>
          <span>MediKiosk</span>
        </div>

        <div className="header-spacer"></div>

      </div>


      <div className="report-question-container">

        <div className="report-question-icon">
          📄
        </div>

        <div className="badge">
          ✦ MEDICAL HISTORY
        </div>

        <h1>
          Do you have any
          <br />
          <span>previous medical reports?</span>
        </h1>

        <p className="report-question-subtitle">
          Previous blood tests, prescriptions, scans, or other
          medical documents can help the doctor understand your
          medical history better.
        </p>


        <div className="report-question-actions">

          <button
            className="report-choice primary"
            onClick={() => {
              setShowReportQuestion(false)
              onReportUpload()
            }}
          >
            <span className="choice-icon">📤</span>

            <div>
              <strong>Yes, Upload Report</strong>
              <small>
                Upload an old medical report
              </small>
            </div>

            <span className="choice-arrow">→</span>
          </button>


          <button
  className="report-choice secondary"
  onClick={() => {
    setShowReportQuestion(false)
    setShowConsent(true)
  }}
>
            <span className="choice-icon">→</span>

            <div>
              <strong>No, Continue Without Report</strong>
              <small>
                I don't have a previous report
              </small>
            </div>

            <span className="choice-arrow">→</span>
          </button>

        </div>


        <div className="report-question-note">
          🔒 Your medical information is kept private and secure.
        </div>

      </div>

    </div>
  )
}

if (showConsent && !showFinalSummary) {
  return (
    <div className="patient-page">

      <div className="patient-header">

        <button
          className="back-button"
          onClick={onBack}
        >
          ← Exit
        </button>

        <div className="patient-logo">
          <div className="logo-icon">✚</div>
          <span>MediKiosk</span>
        </div>

        <div className="header-spacer"></div>

      </div>


      <div className="consent-container">

        <div className="consent-icon">
          🔒
        </div>

        <div className="badge">
          ✦ PRIVACY & CONSENT
        </div>

        <h1>
          Your information
          <br />
          <span>stays protected.</span>
        </h1>

        <p className="consent-subtitle">
          Before we prepare your clinical case summary,
          please review and confirm your consent.
        </p>


        <div className="consent-card">

          <div className="consent-card-row">
            <span>🔐</span>

            <div>
              <strong>Private & Secure</strong>
              <p>
                Your health information is handled only
                for this clinical case-taking session.
              </p>
            </div>
          </div>


          <div className="consent-card-row">
            <span>👨‍⚕️</span>

            <div>
              <strong>Doctor Review</strong>
              <p>
                Information collected by MediKiosk is an
                AI-assisted draft and requires verification
                by a healthcare professional.
              </p>
            </div>
          </div>


          <div className="consent-card-row">
            <span>📄</span>

            <div>
              <strong>Medical Documents</strong>
              <p>
                Uploaded reports and OCR-extracted text
                are included to support clinical review.
              </p>
            </div>
          </div>

        </div>


        <label className="consent-checkbox">

          <input
            type="checkbox"
            checked={consentGiven}
            onChange={(e) =>
              setConsentGiven(e.target.checked)
            }
          />

          <span>
            I understand and consent to the collection
            and processing of my information for preparing
            this clinical case summary.
          </span>

        </label>


        <button
          className="consent-continue-button"
          disabled={!consentGiven}
          onClick={() => {
  setShowConsent(false)
  setFinished(true)

  if (onConsentComplete) {
    onConsentComplete()
  }
}}
        >
          I Agree & Continue →
        </button>

      </div>

    </div>
  )
}

  if (finished || showFinalSummary) {
    const summary = finalDisplaySummary

    return (
      <div className="patient-page">

        <div className="patient-header">

          <button
            className="back-button"
            onClick={onBack}
          >
            ← Back
          </button>

          <div className="patient-logo">
            <div className="logo-icon">✚</div>
            <span>MediKiosk</span>
          </div>

          <div className="header-spacer"></div>

        </div>

        <div className="summary-container">

          <div className="summary-success">
            ✓
          </div>

          <div className="badge">
            ✦ CASE SUMMARY READY
          </div>

          <h1>
            Your health story
            <br />
            <span>has been captured.</span>
          </h1>

          <p className="summary-subtitle">
            MediKiosk has organized your responses into a
            structured clinical case for physician review.
          </p>


          {finalDisplayRedFlag && (
            <div className="red-flag-banner">
              <div className="red-flag-icon">🚨</div>

              <div>
                <strong>Priority Alert</strong>

                <p>
                  Your responses indicate symptoms that may
                  require prompt clinical assessment.
                </p>
                {finalDisplayRedFlagAssessment.priority && finalDisplayRedFlagAssessment.priority !== 'NORMAL' && (
                  <span className="red-flag-priority">Priority: {finalDisplayRedFlagAssessment.priority}</span>
                )}
                {finalDisplayRedFlagAssessment.reasons?.length > 0 && (
                  <div className="red-flag-reasons">
                    <strong>Why was this flagged?</strong>
                    <ul>
                      {finalDisplayRedFlagAssessment.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}


          <div className="clinical-summary-card">

            <div className="summary-card-header">
              <div>
                <span>PATIENT CASE</span>
                <h2>Clinical Summary</h2>
              </div>

              <div className="verified-badge">
                AI Draft
              </div>
            </div>


            <div className="summary-patient">
              <div className="summary-avatar">
                {patient.name
                  ? patient.name.charAt(0).toUpperCase()
                  : 'P'}
              </div>

              <div>
                <strong>{patient.name}</strong>
                <p>
                  {patient.age} years • {patient.gender}
                </p>
              </div>
            </div>


            <div className="summary-grid">

  <div className="summary-item">
    <span>Chief Complaint</span>
    <strong>{summary.complaint}</strong>
  </div>

  <div className="summary-item">
    <span>Duration</span>
    <strong>{summary.duration}</strong>
  </div>


  {summary.mode === 'AYUSH' ? (
    <>
      <div className="summary-item">
        <span>Agni / Appetite</span>
        <strong>{summary.agni}</strong>
      </div>

      <div className="summary-item">
        <span>Digestion</span>
        <strong>{summary.digestion}</strong>
      </div>

      <div className="summary-item">
        <span>Sleep / Nidra</span>
        <strong>{summary.sleep}</strong>
      </div>

      <div className="summary-item">
        <span>Diet / Ahara</span>
        <strong>{summary.diet}</strong>
      </div>

      <div className="summary-item">
        <span>Bowel / Mala</span>
        <strong>{summary.bowel}</strong>
      </div>

      <div className="summary-item">
        <span>Urination / Mutra</span>
        <strong>{summary.urination}</strong>
      </div>

      <div className="summary-item">
        <span>Lifestyle / Vihara</span>
        <strong>{summary.lifestyle}</strong>
      </div>

      <div className="summary-item">
        <span>Stress / Mental State</span>
        <strong>{summary.stress}</strong>
      </div>

      <div className="summary-item full-width">
        <span>Current Treatment</span>
        <strong>{summary.treatment}</strong>
      </div>
    </>
  ) : (
    <>
      <div className="summary-item">
        <span>Location</span>
        <strong>{summary.location}</strong>
      </div>

      <div className="summary-item">
        <span>Severity</span>
        <strong>{summary.severity}</strong>
      </div>

      <div className="summary-item full-width">
        <span>Associated Symptoms</span>
        <strong>{summary.associated}</strong>
      </div>
    </>
  )}

</div>

            {patient.report && (
  <div className="previous-report-card">

    <div className="previous-report-header">
      <div>
        <span>MEDICAL DOCUMENT</span>
        <h3>Previous Medical Report</h3>
      </div>

      <div className="report-status-badge">
        ✓ OCR Extracted
      </div>
    </div>

    <div className="report-file-info">
      <div className="report-file-icon">
        📄
      </div>

      <div>
        <strong>{patient.report.fileName}</strong>
        <p>
          Previous medical document uploaded by patient
        </p>
      </div>
    </div>

    <div className="ocr-section">
      <div className="ocr-label">
        Extracted Report Text
      </div>

      <div className="ocr-text">
        {patient.report.extractedText ||
          'No text could be extracted from this report.'}
      </div>
    </div>

    <div className="report-disclaimer">
      <span>ℹ️</span>
      <p>
        OCR-extracted information is provided for
        physician review and verification.
      </p>
    </div>

  </div>
)}


            <div className="doctor-note">
              <span>👨‍⚕️</span>

              <div>
                <strong>Doctor Review Required</strong>

                <p>
                  This is an AI-assisted draft. A healthcare
                  professional will review and verify the information.
                </p>
              </div>
            </div>

          </div>

          <div className="summary-actions">

            <button
              className="start-case-btn"
              onClick={() => setShowSendConfirmation(true)}
            >
              Send to Doctor →
            </button>

            <button
              className="simple-back-btn"
              onClick={onBack}
            >
              Return to Patient Portal
            </button>

          </div>

          {showSendConfirmation && (
            <div className="send-confirmation-overlay" role="presentation">
              <section className="send-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="send-confirmation-title">
                <div className="send-confirmation-icon">✓</div>
                <h2 id="send-confirmation-title">Send case to doctor?</h2>
                <p>Your case summary will be marked ready for doctor review.</p>
                <div className="send-confirmation-actions">
                  <button className="simple-back-btn" onClick={() => setShowSendConfirmation(false)}>Cancel</button>
                  <button className="start-case-btn" onClick={() => onSendToDoctor?.()}>OK, Send to Doctor</button>
                </div>
              </section>
            </div>
          )}

        </div>

      </div>
    )
  }


  const currentQuestion = questions[step]
  const progress = ((step + 1) / questions.length) * 100

  return (
    
    <div className="patient-page">

      <div className="patient-header">

        <button
          className="back-button"
          onClick={onBack}
        >
          ← Exit
        </button>

        <div className="patient-logo">
          <div className="logo-icon">✚</div>
          <span>MediKiosk</span>
        </div>

        <div className="case-progress">
          {step + 1} / {questions.length}
        </div>

      </div>


      <div className="case-taking-container">

        <div className="case-top">

          <div className="badge">
            ✦ AI CASE TAKING
          </div>

          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            ></div>
          </div>

        </div>


        <div className="case-layout">

          <div className="conversation-area">

            <div className="ai-profile">

              <div className="ai-avatar">
                ✦
              </div>

              <div>
                <strong>MediKiosk AI</strong>
                <p>Patient Case Assistant</p>
              </div>

              <div className="online-dot"></div>

            </div>


            <div className="question-card">

              <div className="question-number">
                QUESTION {String(step + 1).padStart(2, '0')}
              </div>

              <h1>
                {currentQuestion.question}
              </h1>

              {step === 0 && (
                <p className="question-help">
                  You can answer in your own words. Hindi or
                  English is fine.
                </p>
              )}


              {currentQuestion.type === 'text' && (
                <>

                  {caseMode === 'natural' && <div className={`gemini-voice-status ${GeminiLiveService.isConfigured() ? 'available' : 'setup-needed'}`}>
                    <div>
                      <strong>{GeminiLiveService.isConfigured() ? 'Gemini Live voice assistant' : 'Voice assistant setup required'}</strong>
                      <p>{GeminiLiveService.isConfigured() ? voiceStatus : 'Add a Gemini Live token or local demo key to enable live voice.'}</p>
                    </div>
                    {GeminiLiveService.isConfigured() && (
                      <button
                        type="button"
                        className="gemini-ask-button"
                        onClick={() => startGeminiVoice(currentQuestion.question)}
                      >
                        🔊 Hear question
                      </button>
                    )}
                  </div>}

                  {caseMode === 'natural' && voiceCaption && (
                    <div className="gemini-caption" aria-live="polite">
                      <span>Gemini says</span>
                      <p>{voiceCaption}</p>
                    </div>
                  )}

                  {caseMode === 'natural' && voiceError && (
                    <div className="gemini-voice-error" role="alert">{voiceError}</div>
                  )}

                  <div className="voice-input-box">

                    <button
                      className={`voice-main-button ${
                        listening ? 'listening' : ''
                      }`}
                      onClick={startVoiceInput}
                    >
                      <span>
                        {listening ? '●' : '🎙️'}
                      </span>

                      <strong>
                        {listening
                          ? 'Stop and review answer'
                          : caseMode === 'natural' && GeminiLiveService.isConfigured()
                            ? 'Start speaking'
                            : 'Speak your answer'}
                      </strong>
                    </button>

                    <div className="or-divider">
                      OR
                    </div>

                    <textarea
                      value={answer}
                      onChange={(e) =>
                        setAnswer(e.target.value)
                      }
                      placeholder={
                        currentQuestion.placeholder
                      }
                    />

                  </div>

                  <button
                    className="case-next-button"
                    onClick={() => submitAnswer()}
                    disabled={!answer.trim()}
                  >
                    Continue
                    <span>→</span>
                  </button>

                </>
              )}


              {currentQuestion.type === 'options' && (
                <>
                {caseMode === 'natural' && GeminiLiveService.isConfigured() && (
                  <div className="gemini-voice-status available">
                    <div><strong>Gemini Live voice assistant</strong><p>{voiceStatus}</p></div>
                    <button type="button" className="gemini-ask-button" onClick={() => startGeminiVoice(currentQuestion.question)}>🔊 Hear question</button>
                  </div>
                )}
                {caseMode === 'natural' && voiceCaption && <div className="gemini-caption" aria-live="polite"><span>Gemini says</span><p>{voiceCaption}</p></div>}
                {caseMode === 'natural' && voiceError && <div className="gemini-voice-error" role="alert">{voiceError}</div>}
                <div className="answer-options">

                  {currentQuestion.options.map((option) => (
                    <button
                      key={option}
                      className="answer-option"
                      onClick={() =>
                        submitAnswer(option)
                      }
                    >
                      <span>{option}</span>
                      <span>→</span>
                    </button>
                  ))}

                </div>
                </>
              )}

            </div>


            {messages.length > 0 && (
              <div className="recent-response">

                <div className="recent-label">
                  CONVERSATION
                </div>

                {messages.slice(-3).map((message, index) => (
                  <div
                    key={index}
                    className={`message ${message.type}`}
                  >
                    <span>
                      {message.type === 'ai'
                        ? '✦'
                        : 'You'}
                    </span>

                    <p>{message.text}</p>
                  </div>
                ))}

              </div>
            )}

          </div>


          <div className="case-side-panel">

            <div className="side-panel-card">

              <div className="side-title">
                <span>👤</span>
                <div>
                  <strong>Patient</strong>
                  <p>Current session</p>
                </div>
              </div>

              <div className="side-patient">
                <strong>{patient.name}</strong>
                <span>
                  {patient.age} yrs • {patient.gender}
                </span>
              </div>

            </div>


            <div className="side-panel-card">

              <div className="side-title">
                <span>🔒</span>

                <div>
                  <strong>Private & Secure</strong>
                  <p>Your responses are protected</p>
                </div>
              </div>

            </div>


            <div className="side-panel-card ai-tip">

              <div className="side-title">
                <span>💡</span>

                <div>
                  <strong>Helpful Tip</strong>
                  <p>
                    Describe your symptoms clearly.
                    There are no right or wrong answers.
                  </p>
                </div>
              </div>

            </div>

            <div className="side-panel-card report-upload-side">

  <div className="side-title">

    <span>📄</span>

    <div>
      <strong>Previous Reports</strong>

      <p>
        Have an old medical report?
      </p>
    </div>

  </div>

  <button
    className="side-upload-button"
    onClick={() => onReportUpload()}
  >
    Upload Report →
  </button>

</div>

          </div>

        </div>

      </div>

    </div>
  )
}

export default CaseTaking
