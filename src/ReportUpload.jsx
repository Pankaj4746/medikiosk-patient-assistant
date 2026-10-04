import { useRef, useState } from 'react'
import Tesseract from 'tesseract.js'

function ReportUpload({ onBack, onComplete }) {
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [extractedText, setExtractedText] = useState('')
  const [error, setError] = useState('')

  const handleFile = (selectedFile) => {
    setError('')
    setExtractedText('')
    setProgress(0)

    if (!selectedFile) return

    if (!selectedFile.type.startsWith('image/')) {
      setError('Please upload a JPG, JPEG or PNG image.')
      return
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('File size should be less than 10 MB.')
      return
    }

    setFile(selectedFile)

    const imageUrl = URL.createObjectURL(selectedFile)
    setPreview(imageUrl)
  }

  const handleInputChange = (event) => {
    const selectedFile = event.target.files[0]
    handleFile(selectedFile)
  }

  const handleDrop = (event) => {
    event.preventDefault()

    const droppedFile = event.dataTransfer.files[0]
    handleFile(droppedFile)
  }

  const extractText = async () => {
    if (!file) return

    setExtracting(true)
    setError('')
    setExtractedText('')
    setProgress(0)

    try {
      const result = await Tesseract.recognize(
        file,
        'eng',
        {
          logger: (message) => {
            if (
              message.status === 'recognizing text' &&
              typeof message.progress === 'number'
            ) {
              setProgress(
                Math.round(message.progress * 100)
              )
            }
          }
        }
      )

      const text = result.data.text.trim()

      if (!text) {
        setError(
          'No readable text was detected. Please upload a clearer report image.'
        )
      } else {
        setExtractedText(text)
      }

    } catch (err) {
      console.error('OCR Error:', err)

      setError(
        'Unable to read this report. Please try another clear image.'
      )
    } finally {
      setExtracting(false)
    }
  }

  const removeFile = () => {
    setFile(null)
    setPreview('')
    setExtractedText('')
    setProgress(0)
    setError('')

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const continueToCase = () => {
    if (!extractedText) return

    onComplete({
      fileName: file.name,
      extractedText
    })
  }

  return (
    <div className="patient-page">

      {/* Header */}
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


      <div className="report-container">

        {/* Heading */}

        <div className="report-heading">

          <div className="badge">
            ✦ MEDICAL RECORDS
          </div>

          <h1>
            Upload your
            <br />
            <span>medical report.</span>
          </h1>

          <p>
            Upload a previous medical report and MediKiosk
            will extract the readable information to help
            organize your health history.
          </p>

        </div>


        {/* Upload Card */}

        {!file && (

          <div
            className="upload-card"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >

            <div className="upload-icon">
              📄
            </div>

            <h2>
              Upload a medical report
            </h2>

            <p>
              JPG, JPEG or PNG • Maximum 10 MB
            </p>

            <button
              className="upload-button"
              onClick={() =>
                fileInputRef.current?.click()
              }
            >
              Choose Report
              <span>↑</span>
            </button>

            <div className="drop-text">
              or drag and drop your file here
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={handleInputChange}
              hidden
            />

          </div>

        )}


        {/* Selected File */}

        {file && (

          <div className="report-workspace">

            <div className="report-preview-card">

              <div className="report-card-header">

                <div>
                  <span>UPLOADED REPORT</span>
                  <h3>{file.name}</h3>
                </div>

                <button
                  className="remove-file"
                  onClick={removeFile}
                >
                  ×
                </button>

              </div>


              <div className="image-preview">

                <img
                  src={preview}
                  alt="Uploaded medical report"
                />

              </div>

            </div>


            <div className="ocr-card">

              <div className="ocr-heading">

                <div className="ocr-icon">
                  ✦
                </div>

                <div>
                  <h2>
                    AI Document Reader
                  </h2>

                  <p>
                    Extract readable text from your report
                  </p>
                </div>

              </div>


              {!extracting && !extractedText && (

                <div className="ocr-start">

                  <div className="scan-illustration">
                    🔍
                  </div>

                  <p>
                    MediKiosk will scan the uploaded document
                    and extract its text.
                  </p>

                  <button
                    className="scan-button"
                    onClick={extractText}
                  >
                    Extract Report Text
                    <span>→</span>
                  </button>

                </div>

              )}


              {extracting && (

                <div className="ocr-progress">

                  <div className="scanning-icon">
                    ⟳
                  </div>

                  <h3>
                    Reading your report...
                  </h3>

                  <p>
                    Please wait while MediKiosk extracts
                    the readable text.
                  </p>

                  <div className="ocr-progress-track">

                    <div
                      className="ocr-progress-fill"
                      style={{
                        width: `${progress}%`
                      }}
                    ></div>

                  </div>

                  <span className="progress-number">
                    {progress}%
                  </span>

                </div>

              )}


              {extractedText && (

                <div className="ocr-result">

                  <div className="result-header">

                    <div>
                      <span>EXTRACTED TEXT</span>
                      <h3>
                        Report information
                      </h3>
                    </div>

                    <div className="success-badge">
                      ✓ Extracted
                    </div>

                  </div>


                  <textarea
                    value={extractedText}
                    onChange={(event) =>
                      setExtractedText(event.target.value)
                    }
                  />


                  <button
                    className="continue-report-button"
                    onClick={continueToCase}
                  >
                    Continue with Report
                    <span>→</span>
                  </button>

                </div>

              )}

            </div>

          </div>

        )}


        {error && (

          <div className="report-error">
            ⚠️ {error}
          </div>

        )}


        {/* Privacy */}

        <div className="report-privacy">

          <span>🔒</span>

          <div>
            <strong>
              Your medical information is private
            </strong>

            <p>
              This prototype processes the uploaded image
              in your browser for text extraction.
            </p>
          </div>

        </div>

      </div>

    </div>
  )
}

export default ReportUpload
