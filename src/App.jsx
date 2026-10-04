import { useEffect, useRef, useState } from 'react'
import CaseTaking from './CaseTaking'
import ReportUpload from './ReportUpload'
import DoctorDashboard from './DoctorDashboard'
import { buildClinicalSummaryInput, generateClinicalSummary } from './clinicalSummaryService'
import './App.css'

function App() {
  const [page, setPage] = useState(() => localStorage.getItem('medikiosk.patient.page') || 'home')
  const [doctorLoggedIn, setDoctorLoggedIn] = useState(() => localStorage.getItem('medikiosk.auth.doctor') === 'true')
  const [doctorId, setDoctorId] = useState('')
  const [doctorPassword, setDoctorPassword] = useState('')
  const [showPatientLogin, setShowPatientLogin] = useState(false)
  const [showRegistration, setShowRegistration] = useState(false)
  const [showPatientProfile, setShowPatientProfile] = useState(false)
  const [selectedCaseType, setSelectedCaseType] = useState(null)
  const [showStaffLogin, setShowStaffLogin] = useState(false)
  const [loginAadhar, setLoginAadhar] = useState('')
  const [loginOtp, setLoginOtp] = useState('')
  const [loginError, setLoginError] = useState('')
  const [staffId, setStaffId] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [staffError, setStaffError] = useState('')
  const [patientAuthenticated, setPatientAuthenticated] = useState(() => localStorage.getItem('medikiosk.auth.patient') === 'true')
  const [staffAuthenticated, setStaffAuthenticated] = useState(() => localStorage.getItem('medikiosk.auth.staff') === 'true')

  const [patient, setPatient] = useState(() => {
    try {
      const savedPatient = JSON.parse(localStorage.getItem('medikiosk.patient.profile'))
      return savedPatient || { name: '', dob: '', age: '', aadhar: '', gender: '', mobile: '' }
    } catch {
      return { name: '', dob: '', age: '', aadhar: '', gender: '', mobile: '' }
    }
  })

  const [caseSummary, setCaseSummary] = useState(null)
  const [caseRedFlag, setCaseRedFlag] = useState(false)
  const [caseRedFlagAssessment, setCaseRedFlagAssessment] = useState(null)
  const [caseClinicalData, setCaseClinicalData] = useState(null)
  const [clinicalSummary, setClinicalSummary] = useState(null)
  const [clinicalSummaryStatus, setClinicalSummaryStatus] = useState('IDLE')
  const clinicalSummaryRequestRef = useRef({ version: 0, fingerprint: '', status: 'IDLE', controller: null })
  // A method is selected from the patient portal before case taking begins.
  // General is also a safe fallback if a session is refreshed mid-flow.
  const [caseMode, setCaseMode] = useState('general')
  const [consentAfterReport, setConsentAfterReport] = useState(false)

  const [errors, setErrors] = useState({})
  const patientLoggedIn = Boolean(patient.name && (patient.aadhar || patient.mobile))

  // Summarization is additive and deliberately non-blocking: the existing
  // structured case and the independent Red Flag safety result remain usable
  // when Gemini is unavailable or returns an invalid response.
  const generateCaseClinicalSummary = async ({ patientInfo, clinicalData, summary, redFlagAssessment }) => {
    if (!clinicalData || !summary) return
    const input = buildClinicalSummaryInput({
      patientInfo,
      caseMode: clinicalData.caseMode || summary.mode,
      voiceConversation: clinicalData.voiceConversation,
      voiceTranscript: clinicalData.voiceTranscript,
      manualAnswers: clinicalData.manualAnswers,
      existingStructuredSummary: summary,
      medicalReports: patientInfo?.report ? [patientInfo.report] : [],
      redFlagAssessment
    })
    const fingerprint = JSON.stringify(input)
    const currentRequest = clinicalSummaryRequestRef.current

    // Re-rendering or repeated navigation with identical source data should not
    // generate another Gemini request. A changed report produces a new input.
    if (currentRequest.fingerprint === fingerprint && ['LOADING', 'READY'].includes(currentRequest.status)) return

    currentRequest.controller?.abort()
    const version = currentRequest.version + 1
    const controller = new AbortController()
    clinicalSummaryRequestRef.current = { version, fingerprint, status: 'LOADING', controller }
    setClinicalSummaryStatus('LOADING')
    try {
      const generated = await generateClinicalSummary(input, { signal: controller.signal })
      if (clinicalSummaryRequestRef.current.version !== version) return
      setClinicalSummary(generated)
      setClinicalSummaryStatus('READY')
      clinicalSummaryRequestRef.current.status = 'READY'
    } catch {
      // A superseded request must never replace the state of the latest one.
      if (controller.signal.aborted || clinicalSummaryRequestRef.current.version !== version) return
      setClinicalSummary(null)
      setClinicalSummaryStatus('UNAVAILABLE')
      clinicalSummaryRequestRef.current.status = 'UNAVAILABLE'
    }
  }

  useEffect(() => () => clinicalSummaryRequestRef.current.controller?.abort(), [])

  // Patient registration is retained locally so a refresh or return to the app
  // does not silently end the patient session.
  useEffect(() => {
    localStorage.setItem('medikiosk.patient.page', page)
  }, [page])

  useEffect(() => {
    if (patientLoggedIn) localStorage.setItem('medikiosk.patient.profile', JSON.stringify(patient))
  }, [patient, patientLoggedIn])

  // Keep app screens in browser history so the native Back button on phones
  // and laptops returns to the previous MediKiosk screen.
  useEffect(() => {
    window.history.replaceState({ medikioskPage: page }, '', window.location.href)
    const handlePopState = (event) => {
      setPage(event.state?.medikioskPage || 'home')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [page])

  const navigateTo = (nextPage) => {
    if (nextPage === page) return
    window.history.pushState({ medikioskPage: nextPage }, '', window.location.href)
    setPage(nextPage)
  }

  const openPatientAccess = () => {
    navigateTo('home')
    setShowPatientLogin(true)
  }

  const handleChange = (e) => {
    const { name, value } = e.target

    setPatient({
      ...patient,
      [name]: value
    })

    setErrors({
      ...errors,
      [name]: ''
    })
  }

  const validateForm = () => {
    const newErrors = {}

    if (!patient.name.trim()) {
      newErrors.name = 'Please enter your full name'
    }

    if (!patient.dob) {
      newErrors.dob = 'Please enter your date of birth'
    }

    if (!patient.aadhar) {
      newErrors.aadhar = 'Please enter your Aadhaar number'
    } else if (!/^[0-9]{12}$/.test(patient.aadhar)) {
      newErrors.aadhar = 'Enter a valid 12-digit Aadhaar number'
    }

    if (!patient.gender) {
      newErrors.gender = 'Please select your gender'
    }

    setErrors(newErrors)

    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    if (validateForm()) {
      const registeredPatient = { ...patient, age: calculateAge(patient.dob) }
      setPatient(registeredPatient)
      localStorage.setItem('medikiosk.patient.profile', JSON.stringify(registeredPatient))
      localStorage.setItem('medikiosk.auth.patient', 'true')
      setPatientAuthenticated(true)
      setShowRegistration(false)
      navigateTo('patient-portal')
    }
  }

  const calculateAge = (dob) => {
    if (!dob) return ''
    const birthDate = new Date(dob)
    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const monthDifference = today.getMonth() - birthDate.getMonth()
    if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birthDate.getDate())) age -= 1
    return age > 0 ? String(age) : ''
  }

  const handlePatientLogin = (event) => {
    event.preventDefault()
    if (!/^[0-9]{12}$/.test(loginAadhar)) {
      setLoginError('Enter a valid 12-digit Aadhaar number.')
      return
    }
    if (loginOtp !== '1234') {
      setLoginError('Temporary OTP is 1234. Please try again.')
      return
    }
    const storedPatient = patient.aadhar === loginAadhar ? patient : null
    if (!storedPatient) {
      setLoginError('No patient is registered with this Aadhaar number. Please register first.')
      return
    }
    setLoginError('')
    setShowPatientLogin(false)
    localStorage.setItem('medikiosk.auth.patient', 'true')
    setPatientAuthenticated(true)
    navigateTo('patient-portal')
  }

  const handleStaffLogin = (event) => {
    event.preventDefault()
    if (staffId !== 'staff' || staffPassword !== '1234') {
      setStaffError('Use Staff ID “staff” and temporary password “1234”.')
      return
    }
    localStorage.setItem('medikiosk.auth.staff', 'true')
    setStaffAuthenticated(true)
    setShowStaffLogin(false)
    setStaffError('')
    navigateTo('staff-portal')
  }

  /* =========================
     PATIENT WELCOME
  ========================= */

  if (page === 'welcome' || page === 'patient-portal') {
    return (
      <div className="patient-page">

        <div className="patient-header patient-portal-header">

          <button
            className="back-button"
            onClick={() => navigateTo('home')}
          >
            ← Back
          </button>

          <div className="patient-logo">
            <div className="logo-icon">✚</div>
            <span>MediKiosk</span>
          </div>

          <button className="patient-profile-button" onClick={() => setShowPatientProfile(true)} aria-label="Open patient profile">
            <span>{patient.name ? patient.name.charAt(0).toUpperCase() : 'P'}</span>
            <small>Profile</small>
          </button>

        </div>


        <main className="patient-portal-content">
          <span className="portal-kicker">PATIENT CASE TAKING</span>
          
          <p>Choose a care approach. Your doctor will review the information you share.</p>
          <div className="care-type-grid">
            <button className="care-type-card" onClick={() => setSelectedCaseType('general')}>
              <span className="care-type-icon">🩺</span><h2>Generic</h2><p>Share your symptoms through a guided general health assessment.</p><span>Continue →</span>
            </button>
            <button className="care-type-card ayush" onClick={() => setSelectedCaseType('ayush')}>
              <span className="care-type-icon">🌿</span><h2>AYUSH</h2><p>Share your history through an Ayurveda-focused wellness assessment.</p><span>Continue →</span>
            </button>
          </div>
        </main>

        {selectedCaseType && (
          <div className="patient-login-overlay" onClick={() => setSelectedCaseType(null)}>
            <section className="patient-login-modal case-method-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
              <button className="modal-close" onClick={() => setSelectedCaseType(null)} aria-label="Close">×</button>
              <span className="portal-kicker">{selectedCaseType === 'ayush' ? 'AYUSH' : 'GENERIC'} CASE TAKING</span>
              <h2>How would you like to continue?</h2>
              <p>Choose natural voice conversation or answer a short set of smart questions.</p>
              <div className="case-method-options">
                <button onClick={() => { setCaseMode('natural'); setSelectedCaseType(null); navigateTo('case-taking') }}><span>🎙️</span><strong>Natural Speaking</strong><small>Talk freely with Gemini voice interview</small></button>
                <button onClick={() => { setCaseMode(selectedCaseType); setSelectedCaseType(null); navigateTo('case-taking') }}><span>🧠</span><strong>Smart Questions</strong><small>Answer guided questions by tapping options</small></button>
              </div>
            </section>
          </div>
        )}

        {showPatientProfile && (
          <div className="patient-login-overlay" onClick={() => setShowPatientProfile(false)}>
            <section className="patient-login-modal patient-profile-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
              <button className="modal-close" onClick={() => setShowPatientProfile(false)} aria-label="Close">×</button>
              <span className="portal-kicker">PATIENT PROFILE</span>
              <h2>{patient.name || 'Patient'}</h2>
              <div className="profile-details"><span>Date of birth<strong>{patient.dob || 'Not provided'}</strong></span><span>Age<strong>{patient.age || 'Not provided'}</strong></span><span>Gender<strong>{patient.gender || 'Not provided'}</strong></span><span>Aadhaar<strong>{patient.aadhar ? `•••• •••• ${patient.aadhar.slice(-4)}` : 'Not provided'}</strong></span></div>
              <div className="profile-history-section"><h3>Past medical & surgical history</h3><p>No history added yet.</p></div>
              <div className="profile-history-section"><h3>Drug & allergy history</h3><p>No drug or allergy history added yet.</p></div>
              <div className="profile-history-section"><h3>Family & personal history</h3><p>No family or personal history added yet.</p></div>
              <button
                className="patient-profile-logout"
                onClick={() => {
                  localStorage.removeItem('medikiosk.auth.patient')
                  setPatientAuthenticated(false)
                  setShowPatientProfile(false)
                  navigateTo('home')
                }}
              >
                Logout
              </button>
            </section>
          </div>
        )}

      </div>
    )
  }


  /* =========================
     CASE TAKING
  ========================= */

if (page === 'case-taking') {
  return (
    <CaseTaking
      patient={patient}

      caseMode={caseMode}
      onCaseModeChange={setCaseMode}

      onBack={() => navigateTo('welcome')}

      onCaseComplete={({ summary, redFlag, redFlagAssessment, clinicalData }) => {
        setCaseSummary(summary)
        setCaseRedFlag(redFlag)
        setCaseRedFlagAssessment(redFlagAssessment)
        setCaseClinicalData(clinicalData)
        void generateCaseClinicalSummary({
          patientInfo: patient,
          clinicalData,
          summary,
          redFlagAssessment
        })
      }}

      onReportUpload={() => navigateTo('report-upload')}
      onSendToDoctor={() => navigateTo('patient-portal')}
    />
  )
}

if (page === 'report-upload') {
  return (
    <ReportUpload
  patient={patient}
  onBack={() => navigateTo('welcome')}
  onComplete={(report) => {
    const updatedPatient = { ...patient, report }
    setPatient(updatedPatient)
    if (caseClinicalData && caseSummary) {
      void generateCaseClinicalSummary({
        patientInfo: updatedPatient,
        clinicalData: caseClinicalData,
        summary: caseSummary,
        redFlagAssessment: caseRedFlagAssessment
      })
    }
    setConsentAfterReport(true)
    navigateTo('case-taking-summary')
  }}
/>
  )
}

if (page === 'case-taking-summary') {
  return (
    <CaseTaking
  patient={patient}
  caseMode={caseMode}
  onCaseModeChange={setCaseMode}
  initialSummary={caseSummary}
  initialRedFlag={caseRedFlag}
  initialRedFlagAssessment={caseRedFlagAssessment}
  showFinalSummary={!consentAfterReport}
  initialShowConsent={consentAfterReport}
  onConsentComplete={() => setConsentAfterReport(false)}
  onBack={() => navigateTo('welcome')}
  onReportUpload={() => navigateTo('report-upload')}
  onSendToDoctor={() => navigateTo('patient-portal')}
/>
  )
}

  /* =========================
     DOCTOR DASHBOARD
  ========================= */
  /* =========================
   DOCTOR LOGIN
========================= */

if (page === 'doctor-login') {
  return (
    <div className="doctor-login-page">

      <div className="doctor-login-card">

        <div className="doctor-login-logo">
          <div className="logo-icon">✚</div>
          <span>MediKiosk</span>
        </div>

        <div className="doctor-login-icon">
          👨‍⚕️
        </div>

        <div className="doctor-login-heading">
          <span className="eyebrow">CLINICAL WORKSPACE</span>

          <h1>Doctor Login</h1>

          <p>
            Sign in to access the patient case management
            dashboard.
          </p>
        </div>

        <form
  onSubmit={(e) => {
    e.preventDefault()

    if (doctorId === 'doctor' && doctorPassword === '1234') {
      localStorage.setItem('medikiosk.auth.doctor', 'true')
      setDoctorLoggedIn(true)
      navigateTo('doctor-dashboard')
    } else {
      alert('Invalid Doctor ID or Password')
    }
  }}
>

          <div className="doctor-login-field">

            <label>Doctor ID</label>

            <input
  type="text"
  placeholder="Enter Doctor ID"
  value={doctorId}
  onChange={(e) => setDoctorId(e.target.value)}
  required
/>

          </div>

          <div className="doctor-login-field">

            <label>Password</label>

            <input
  type="password"
  placeholder="Enter Password"
  value={doctorPassword}
  onChange={(e) => setDoctorPassword(e.target.value)}
  required
/>

          </div>

          <button
            type="submit"
            className="doctor-login-button"
          >
            Login to Dashboard →
          </button>

        </form>

        <button
          className="doctor-login-back"
          onClick={() => navigateTo('home')}
        >
          ← Back to Home
        </button>

        <div className="doctor-demo-note">
          Demo Login • Prototype Mode
        </div>

      </div>

    </div>
  )
}

  if (page === 'doctor-dashboard') {
  if (!doctorLoggedIn) {
    return (
      <div className="doctor-login-page">
        <div className="doctor-login-card">
          <div className="doctor-login-logo">
            <div className="logo-icon">✚</div>
            <span>MediKiosk</span>
          </div>

          <div className="doctor-login-icon">🔒</div>

          <div className="doctor-login-heading">
            <span className="eyebrow">ACCESS RESTRICTED</span>
            <h1>Doctor Login Required</h1>
            <p>
              Please login as a doctor to access the clinical dashboard.
            </p>
          </div>

          <button
            className="doctor-login-button"
            onClick={() => navigateTo('doctor-login')}
          >
            Go to Doctor Login →
          </button>

          <button
            className="doctor-login-back"
            onClick={() => navigateTo('home')}
          >
            ← Back to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <DoctorDashboard
  patient={patient}
  caseSummary={caseSummary}
  caseRedFlag={caseRedFlag}
  redFlagAssessment={caseRedFlagAssessment}
  clinicalSummary={clinicalSummary}
  clinicalSummaryStatus={clinicalSummaryStatus}
  onBack={() => navigateTo('welcome')}
  onLogout={() => {
    localStorage.removeItem('medikiosk.auth.doctor')
    setDoctorLoggedIn(false)
    navigateTo('home')
  }}
/>
  )
}

  if (page === 'staff-portal') {
    return (
      <div className="simple-public-page">
        <header className="simple-header">
          <button className="simple-brand" onClick={() => navigateTo('home')}><span>✚</span> MediKiosk</button>
        </header>
        <main className="simple-info-content">
          <span className="simple-kicker">STAFF WORKSPACE</span>
          <h1>Welcome, Staff</h1>
          <p>The staff workspace is ready for the next features you add.</p>
          <div className="staff-portal-actions">
            <button className="simple-back-button" onClick={() => navigateTo('home')}>← Back to home</button>
            <button
              className="staff-logout-button"
              onClick={() => {
                localStorage.removeItem('medikiosk.auth.staff')
                setStaffAuthenticated(false)
                navigateTo('home')
              }}
            >
              Logout
            </button>
          </div>
        </main>
      </div>
    )
  }

  if (page === 'how-it-works') {
    return (
      <div className="simple-public-page">
        <header className="simple-header">
          <button className="simple-brand" onClick={() => navigateTo('home')}><span>✚</span> MediKiosk</button>
          <div className="simple-login-actions"><button className="simple-link" onClick={() => navigateTo('about')}>About</button></div>
        </header>
        <main className="simple-info-content">
          <span className="simple-kicker">HOW IT WORKS?</span><h1>From patient story to clinician review.</h1>
          <div className="simple-steps"><article><b>1</b><h2>Patient logs in</h2><p>Enter basic details to begin a secure intake session.</p></article><article><b>2</b><h2>Choose a method</h2><p>Speak naturally with Gemini or answer Smart Questions.</p></article><article><b>3</b><h2>Doctor reviews</h2><p>The clinician checks the draft before making any clinical decision.</p></article></div>
          <button className="simple-back-button" onClick={() => navigateTo('home')}>← Back to home</button>
        </main>
      </div>
    )
  }

  if (page === 'about') {
    return (
      <div className="simple-public-page">
        <header className="simple-header">
          <button className="simple-brand" onClick={() => navigateTo('home')}><span>✚</span> MediKiosk</button>
          <div className="simple-login-actions"><button className="simple-link" onClick={() => navigateTo('how-it-works')}>How it works</button><button className="simple-patient-button" onClick={() => patientAuthenticated ? navigateTo('patient-portal') : openPatientAccess()}>Patient</button><button className="simple-doctor-button" onClick={() => doctorLoggedIn ? navigateTo('doctor-dashboard') : navigateTo('doctor-login')}>Doctor</button></div>
        </header>
        <main className="simple-info-content simple-about-content">
          <span className="simple-kicker">ABOUT MEDIKIOSK</span><h1>A clearer start to every hospital visit.</h1><p>MediKiosk helps patients share their health history in simple language and helps clinicians review a structured draft. It supports clinical intake; it does not diagnose or replace a doctor.</p>
          <button className="simple-back-button" onClick={() => navigateTo('home')}>← Back to home</button>
        </main>
      </div>
    )
  }

  if (page === 'home') {
    return (
      <div className="portal-home">
        <header className="portal-home-header">
          <button className="portal-brand"  onClick={() => navigateTo('home')}><span>✚</span> MediKiosk</button>
          <nav className="portal-nav" aria-label="Public information">
            <button onClick={() => navigateTo('how-it-works')}>How it works?</button>
            <button onClick={() => document.getElementById('home-about')?.scrollIntoView({ behavior: 'smooth' })}>About</button>
          </nav>
        </header>

        <main className="portal-home-main">
        
          <h2>Welcome to <span>MediKiosk</span></h2>
          <p className="continue-as-label">Continue as</p>
          <div className="role-grid">
            <button className="role-card patient-role" onClick={() => patientAuthenticated ? navigateTo('patient-portal') : setShowPatientLogin(true)}>
              <span className="role-icon">👤</span><strong>Patient</strong><small>Login or register</small>
            </button>
            <button className="role-card" onClick={() => doctorLoggedIn ? navigateTo('doctor-dashboard') : navigateTo('doctor-login')}>
              <span className="role-icon">👨‍⚕️</span><strong>Doctor</strong><small>Clinical workspace</small>
            </button>
            <button className="role-card" onClick={() => staffAuthenticated ? navigateTo('staff-portal') : setShowStaffLogin(true)}>
              <span className="role-icon">🧑‍💼</span><strong>Staff</strong><small>Front-desk workspace</small>
            </button>
          </div>
        </main>

        <footer className="portal-home-footer" id="home-about">
          <span className="portal-kicker">ABOUT MEDIKIOSK</span>
          <h2>A clearer start to every hospital visit.</h2>
          <p>MediKiosk helps patients share their health history in simple language and gives doctors a structured, reviewable draft. It supports clinical intake; it does not diagnose or replace a doctor.</p>
        </footer>

        {showPatientLogin && (
          <div className="patient-login-overlay" onClick={() => setShowPatientLogin(false)}>
            <section className="patient-login-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
              <button className="modal-close" onClick={() => setShowPatientLogin(false)} aria-label="Close">×</button>
              <span className="portal-kicker">PATIENT ACCESS</span>
              <h2>Continue as Patient</h2>
              <p>Enter your Aadhaar number and temporary OTP to open your patient portal.</p>
              <form onSubmit={handlePatientLogin}>
                <label>Aadhaar Number<input value={loginAadhar} maxLength="12" inputMode="numeric" onChange={(event) => { setLoginAadhar(event.target.value.replace(/\D/g, '')); setLoginError('') }} placeholder="12-digit Aadhaar number" /></label>
                <label>OTP<input value={loginOtp} maxLength="4" inputMode="numeric" onChange={(event) => { setLoginOtp(event.target.value.replace(/\D/g, '')); setLoginError('') }} placeholder="Enter OTP" /></label>
                {loginError && <p className="patient-login-error">{loginError}</p>}
                <button type="submit" className="portal-primary-button">Verify & Continue →</button>
              </form>
              <p className="otp-note">Demo OTP: <strong>1234</strong></p>
              <div className="register-prompt"><span>New to MediKiosk?</span><button onClick={() => { setShowPatientLogin(false); setShowRegistration(true) }}>Register now</button></div>
            </section>
          </div>
        )}

        {showStaffLogin && (
          <div className="patient-login-overlay" onClick={() => setShowStaffLogin(false)}>
            <section className="patient-login-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
              <button className="modal-close" onClick={() => setShowStaffLogin(false)} aria-label="Close">×</button>
              <span className="portal-kicker">STAFF ACCESS</span>
              <h2>Continue as Staff</h2>
              <p>Sign in once on this device to open the staff workspace automatically next time.</p>
              <form onSubmit={handleStaffLogin}>
                <label>Staff ID<input value={staffId} onChange={(event) => { setStaffId(event.target.value); setStaffError('') }} placeholder="Enter Staff ID" /></label>
                <label>Password<input type="password" value={staffPassword} onChange={(event) => { setStaffPassword(event.target.value); setStaffError('') }} placeholder="Enter password" /></label>
                {staffError && <p className="patient-login-error">{staffError}</p>}
                <button type="submit" className="portal-primary-button">Continue →</button>
              </form>
              <p className="otp-note">Demo Staff ID: <strong>staff</strong> · Password: <strong>1234</strong></p>
            </section>
          </div>
        )}

        {showRegistration && (
          <div className="patient-login-overlay" onClick={() => setShowRegistration(false)}>
            <section className="patient-login-modal registration-modal" onClick={(event) => event.stopPropagation()} aria-modal="true" role="dialog">
              <button className="modal-close" onClick={() => setShowRegistration(false)} aria-label="Close">×</button>
              <span className="portal-kicker">PATIENT REGISTRATION</span>
              <h2>Create your patient account</h2>
              <p>Enter your basic information to begin your MediKiosk session.</p>
              <form onSubmit={handleSubmit}>
                <label>Full Name<input type="text" name="name" value={patient.name} onChange={handleChange} placeholder="Enter your full name" /></label>
                {errors.name && <p className="patient-login-error">{errors.name}</p>}
                <div className="registration-form-row">
                  <label>Date of Birth<input type="date" name="dob" value={patient.dob || ''} onChange={handleChange} /></label>
                  <label>Gender<select name="gender" value={patient.gender} onChange={handleChange}><option value="">Select</option><option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option><option value="Prefer not to say">Prefer not to say</option></select></label>
                </div>
                {errors.dob && <p className="patient-login-error">{errors.dob}</p>}
                {errors.gender && <p className="patient-login-error">{errors.gender}</p>}
                <label>Aadhaar Number<input type="text" name="aadhar" inputMode="numeric" maxLength="12" value={patient.aadhar || ''} onChange={handleChange} placeholder="12-digit Aadhaar number" /></label>
                {errors.aadhar && <p className="patient-login-error">{errors.aadhar}</p>}
                <button type="submit" className="portal-primary-button">Register & Continue →</button>
              </form>
              <div className="register-prompt"><span>Already registered?</span><button onClick={() => { setShowRegistration(false); setShowPatientLogin(true) }}>Login instead</button></div>
            </section>
          </div>
        )}
      </div>
    )
  }

  /* =========================
     HOME / LANDING PAGE
  ========================= */

  return (
    <div className="app">

      {/* Navbar */}
      <header className="navbar">

        <div className="logo">
          <div className="logo-icon">✚</div>
          <span>MediKiosk</span>
        </div>

        <nav className="nav-links">
          <a href="#home">Home</a>
          <a href="#how-it-works">How It Works</a>
          <a href="#features">Features</a>
          <a href="#about">About</a>
        </nav>

        <div className="nav-buttons">

          <button
            className="patient-nav-btn"
            onClick={() => navigateTo(patientLoggedIn ? 'welcome' : 'registration')}
          >
            {patientLoggedIn ? 'Continue as Patient' : 'Patient'}
          </button>

          <button
  className="doctor-nav-btn"
  onClick={() => navigateTo('doctor-login')}
>
  Doctor Login
</button>

        </div>

      </header>


      <main>

        {/* Hero */}
        <section className="hero" id="home">

          <div className="hero-content">

            <div className="badge">
              ✦ AI-Powered Healthcare
            </div>

            <h1>
              Your Health.
              <br />
              <span>Your Voice.</span>
              <br />
              Your History.
            </h1>

            <p className="hero-description">
              MediKiosk uses conversational AI to collect patient history,
              understand symptoms, organize medical information and prepare
              a structured case summary for doctors.
            </p>

            <div className="hero-buttons">

              <button
                className="primary-btn"
                onClick={() => navigateTo(patientLoggedIn ? 'welcome' : 'registration')}
              >
                {patientLoggedIn ? 'Continue My Session' : 'Start as Patient'}
                <span>→</span>
              </button>

              <button
  className="secondary-btn"
  onClick={() => navigateTo('doctor-login')}
>
  Doctor Login
  <span>→</span>
</button>

            </div>

            <div className="trust-text">
              <span>✓</span>
              AI-assisted &nbsp; • &nbsp;
              <span>✓</span>
              Doctor verified &nbsp; • &nbsp;
              <span>✓</span>
              Privacy focused
            </div>

          </div>


          {/* Hero Visual */}
          <div className="hero-visual">

            <div className="medical-card main-card">

              <div className="card-top">

                <div>
                  <p className="small-label">
                    PATIENT CASE
                  </p>

                  <h3>
                    Clinical Summary
                  </h3>
                </div>

                <div className="status-dot">
                  ✓
                </div>

              </div>


              <div className="patient-mini">

                <div className="avatar">
                  RK
                </div>

                <div>
                  <strong>Rahul Kumar</strong>
                  <p>24 years • Male</p>
                </div>

              </div>


              <div className="case-item">
                <div className="case-icon">🩺</div>

                <div>
                  <span>Chief Complaint</span>
                  <strong>Abdominal Pain</strong>
                </div>
              </div>


              <div className="case-item">
                <div className="case-icon">◷</div>

                <div>
                  <span>Duration</span>
                  <strong>5 Days</strong>
                </div>
              </div>


              <div className="case-item">
                <div className="case-icon">◉</div>

                <div>
                  <span>Severity</span>
                  <strong>7 / 10</strong>
                </div>
              </div>


              <div className="ai-summary">

                <div className="ai-icon">
                  ✦
                </div>

                <div>
                  <strong>
                    AI Summary Ready
                  </strong>

                  <p>
                    Prepared for physician review
                  </p>
                </div>

              </div>

            </div>


            <div className="floating-card voice-card">

              <div className="voice-icon">
                🎙️
              </div>

              <div>
                <strong>
                  Voice Interview
                </strong>

                <p>
                  Listening...
                </p>
              </div>

              <div className="wave">
                <i></i>
                <i></i>
                <i></i>
                <i></i>
                <i></i>
              </div>

            </div>


            <div className="floating-card secure-card">

              <span>🔒</span>

              <div>
                <strong>
                  Secure Records
                </strong>

                <p>
                  Protected health data
                </p>
              </div>

            </div>

          </div>

        </section>


        {/* How It Works */}
        <section className="how-section" id="how-it-works">

          <div className="section-heading">

            <div className="section-badge">
              SIMPLE & SMART
            </div>

            <h2>
              From Patient Voice
              <br />
              to Doctor's Case Sheet
            </h2>

            <p>
              MediKiosk simplifies the patient intake process in four simple steps.
            </p>

          </div>


          <div className="steps">

            <div className="step-card">
              <div className="step-number">01</div>
              <div className="step-icon">🎙️</div>
              <h3>Speak</h3>
              <p>
                Patients describe their health concerns using their own voice
                or guided touch interface.
              </p>
            </div>

            <div className="step-card">
              <div className="step-number">02</div>
              <div className="step-icon">🧠</div>
              <h3>Understand</h3>
              <p>
                AI understands the patient's responses and asks relevant
                follow-up questions.
              </p>
            </div>

            <div className="step-card">
              <div className="step-number">03</div>
              <div className="step-icon">📄</div>
              <h3>Organize</h3>
              <p>
                Medical history and uploaded reports are organized into
                structured clinical information.
              </p>
            </div>

            <div className="step-card">
              <div className="step-number">04</div>
              <div className="step-icon">👨‍⚕️</div>
              <h3>Assist Doctor</h3>
              <p>
                Doctors receive a concise case summary and remain in control
                of the final clinical decision.
              </p>
            </div>

          </div>

        </section>


        {/* Features */}
        <section className="features-section" id="features">

          <div className="section-heading">

            <div className="section-badge">
              KEY FEATURES
            </div>

            <h2>
              Built for Better
              <br />
              Clinical Conversations
            </h2>

          </div>


          <div className="feature-grid">

            <div className="feature-card">
              <div className="feature-icon">🎙️</div>
              <h3>Voice-Based Case Taking</h3>
              <p>
                Let patients explain their symptoms naturally using voice
                interaction.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">📑</div>
              <h3>Medical Report Extraction</h3>
              <p>
                Upload previous medical reports and organize important
                information automatically.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon">✦</div>
              <h3>AI Clinical Summary</h3>
              <p>
                Convert collected information into a structured,
                doctor-friendly case summary.
              </p>
            </div>

            <div className="feature-card alert-feature">
              <div className="feature-icon">🚨</div>
              <h3>Red-Flag Detection</h3>
              <p>
                Highlight potentially urgent symptoms so healthcare staff can
                prioritize clinical assessment.
              </p>
            </div>

          </div>

        </section>


        {/* About */}
        <section className="about-section" id="about">

          <div className="about-content">

            <div className="section-badge">
              ABOUT MEDIKIOSK
            </div>

            <h2>
              Technology that assists.
              <br />
              Doctors who decide.
            </h2>

            <p>
              MediKiosk is designed to reduce the time spent collecting
              repetitive patient history while helping doctors begin
              consultations with better-organized information.
            </p>

            <div className="about-points">

              <div>
                <span>✓</span>
                Patient remains at the center
              </div>

              <div>
                <span>✓</span>
                AI assists, doctor verifies
              </div>

              <div>
                <span>✓</span>
                Designed with privacy in mind
              </div>

            </div>

          </div>


          <div className="about-visual">

            <div className="big-plus">+</div>

            <div className="about-circle circle-one"></div>
            <div className="about-circle circle-two"></div>

            <div className="about-message">

              <span>✦</span>

              <strong>
                Human + AI
              </strong>

              <p>
                Better clinical workflow
              </p>

            </div>

          </div>

        </section>

      </main>


      {/* Footer */}
      <footer className="footer">

        <div className="footer-logo">

          <div className="logo-icon">
            ✚
          </div>

          <div>
            <strong>MediKiosk</strong>
            <p>
              AI-assisted patient case taking
            </p>
          </div>

        </div>


        <div className="footer-right">
          <span>Privacy focused</span>
          <span>•</span>
          <span>Doctor verified</span>
          <span>•</span>
          <span>Healthcare prototype</span>
        </div>

      </footer>

    </div>
  )
}

export default App
