const LIVE_MODEL = 'gemini-3.1-flash-live-preview'
const INPUT_SAMPLE_RATE = 16000
const OUTPUT_SAMPLE_RATE = 24000

const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

const floatToPcm16 = (samples) => {
  const output = new ArrayBuffer(samples.length * 2)
  const view = new DataView(output)

  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample))
    view.setInt16(
      index * 2,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true
    )
  })

  return output
}

const resample = (input, inputRate, outputRate) => {
  if (inputRate === outputRate) return input

  const ratio = inputRate / outputRate
  const output = new Float32Array(Math.round(input.length / ratio))

  for (let index = 0; index < output.length; index += 1) {
    const sourceIndex = index * ratio
    const before = Math.floor(sourceIndex)
    const after = Math.min(before + 1, input.length - 1)

    output[index] =
      input[before] +
      (input[after] - input[before]) * (sourceIndex - before)
  }

  return output
}

export class GeminiLiveService {
  constructor(callbacks = {}) {
    this.callbacks = callbacks
    this.socket = null
    this.audioContext = null
    this.microphoneStream = null
    this.microphoneSource = null
    this.processor = null
    this.silentGain = null
    this.nextAudioTime = 0
  }

  static isConfigured() {
    return Boolean(
      import.meta.env.VITE_GEMINI_LIVE_TOKEN ||
      import.meta.env.VITE_GEMINI_API_KEY
    )
  }

  async connect() {
    const token = import.meta.env.VITE_GEMINI_LIVE_TOKEN
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY

    if (!token && !apiKey) {
      throw new Error(
        'Gemini voice is not configured. Add VITE_GEMINI_LIVE_TOKEN or VITE_GEMINI_API_KEY to .env.local.'
      )
    }

    this.audioContext = this.audioContext || new AudioContext()
    await this.audioContext.resume()

    const endpoint = token
      ? `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`
      : `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`

    await new Promise((resolve, reject) => {
      let settled = false
      let timeout

      const fail = (error) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        reject(error)
      }

      const succeed = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        resolve()
      }

      this.socket = new WebSocket(endpoint)

      this.socket.onopen = () => {
        this.callbacks.onStatus?.('Connecting to voice assistant…')

        this.socket.send(
          JSON.stringify({
            setup: {
              model: `models/${LIVE_MODEL}`,
              generationConfig: {
                responseModalities: ['AUDIO']
              },
              inputAudioTranscription: {
                languageCodes: ['en-IN', 'hi-IN']
              },
              outputAudioTranscription: {},
              systemInstruction: {
                parts: [
                  {
                    text: 'You are Aarogya, a clinical intake voice assistant for an Indian hospital. Ask only one direct, concise, plain-language question at a time, in Hindi, English, or Hinglish matching the patient. Keep every reply below two short sentences. Ask only about the current illness: main symptom, onset, duration, severity, key related symptoms, medicines, allergies, and conditions. Do not diagnose, prescribe, or claim certainty. If the patient mentions severe chest pain, trouble breathing, fainting, confusion, severe bleeding, or rapidly worsening symptoms, calmly tell them to alert hospital staff immediately. The physician reviews all answers.'
                  }
                ]
              }
            }
          })
        )
      }

      this.socket.onmessage = async (event) => {
        const errorMessage = await this.handleMessage(event)

        if (errorMessage) {
          fail(new Error(errorMessage))
        }
      }

      this.socket.onerror = () => {
        fail(
          new Error(
            'Could not open the Gemini Live WebSocket. Check your key, token, network, and browser console.'
          )
        )
      }

      this.socket.onclose = (event) => {
        this.callbacks.onStatus?.('Voice assistant disconnected')

        if (!settled) {
          fail(
            new Error(
              event.reason ||
                `Gemini Live closed the connection (code ${event.code || 'unknown'}). Check that your API key has Live API access.`
            )
          )
        }
      }

      timeout = window.setTimeout(() => {
        fail(
          new Error(
            'Gemini Live did not complete setup within 30 seconds. Confirm that this API key can run Gemini Live in Google AI Studio, then retry.'
          )
        )
      }, 30000)

      const originalReady = this.callbacks.onReady

      this.callbacks.onReady = () => {
        originalReady?.()
        succeed()
      }
    })
  }

  async handleMessage(event) {
    let message

    try {
      let rawMessage = event.data

      // Gemini Live normally returns text frames, but some browsers or proxies
      // expose frames as Blob or ArrayBuffer. Decode every supported frame type
      // so an otherwise valid setupComplete response is not ignored.
      if (rawMessage instanceof Blob) {
        rawMessage = await rawMessage.text()
      } else if (rawMessage instanceof ArrayBuffer) {
        rawMessage = new TextDecoder().decode(rawMessage)
      }

      message = JSON.parse(rawMessage)
    } catch {
      return undefined
    }

    if (Object.hasOwn(message, 'setupComplete')) {
      this.callbacks.onStatus?.('Voice assistant ready')
      this.callbacks.onReady?.()
      return undefined
    }

    if (message.error) {
      const messageText =
        message.error.message || 'Gemini Live returned an error.'

      this.callbacks.onError?.(messageText)
      return messageText
    }

    const content = message.serverContent

    if (!content) return undefined

    if (content.inputTranscription?.text) {
      this.callbacks.onPatientTranscript?.(content.inputTranscription.text)
    }

    if (content.outputTranscription?.text) {
      this.callbacks.onAssistantTranscript?.(content.outputTranscription.text)
    }

    content.modelTurn?.parts?.forEach((part) => {
      if (part.inlineData?.data) {
        this.playPcm(part.inlineData.data)
      }
    })

    return undefined
  }

  ask(question) {
    this.sendText(
      `Ask this question exactly, then wait for the patient's answer: ${question}`
    )
  }

  sendText(text) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ realtimeInput: { text } }))
    }
  }

  async startMicrophone() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Start the voice assistant first.')
    }

    if (this.microphoneStream) return

    this.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })

    this.audioContext = this.audioContext || new AudioContext()
    await this.audioContext.resume()

    this.microphoneSource =
      this.audioContext.createMediaStreamSource(this.microphoneStream)

    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)
    this.silentGain = this.audioContext.createGain()
    this.silentGain.gain.value = 0

    this.processor.onaudioprocess = (event) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return

      const samples = resample(
        event.inputBuffer.getChannelData(0),
        this.audioContext.sampleRate,
        INPUT_SAMPLE_RATE
      )

      this.socket.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: toBase64(floatToPcm16(samples)),
              mimeType: 'audio/pcm;rate=16000'
            }
          }
        })
      )
    }

    this.microphoneSource.connect(this.processor)
    this.processor.connect(this.silentGain)
    this.silentGain.connect(this.audioContext.destination)
  }

  stopMicrophone() {
    this.processor?.disconnect()
    this.microphoneSource?.disconnect()
    this.silentGain?.disconnect()

    this.microphoneStream?.getTracks().forEach((track) => track.stop())

    this.processor = null
    this.microphoneSource = null
    this.silentGain = null
    this.microphoneStream = null
  }

  playPcm(base64Audio) {
    this.audioContext = this.audioContext || new AudioContext()

    const binary = atob(base64Audio)
    const samples = new Float32Array(binary.length / 2)
    const view = new DataView(new ArrayBuffer(binary.length))

    for (let index = 0; index < binary.length; index += 1) {
      view.setUint8(index, binary.charCodeAt(index))
    }

    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = view.getInt16(index * 2, true) / 0x8000
    }

    const audioBuffer = this.audioContext.createBuffer(
      1,
      samples.length,
      OUTPUT_SAMPLE_RATE
    )

    audioBuffer.copyToChannel(samples, 0)

    const source = this.audioContext.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.audioContext.destination)

    this.nextAudioTime = Math.max(
      this.nextAudioTime,
      this.audioContext.currentTime
    )

    source.start(this.nextAudioTime)
    this.nextAudioTime += audioBuffer.duration
  }

  disconnect() {
    this.stopMicrophone()
    this.socket?.close()
    this.socket = null

    this.audioContext?.close()
    this.audioContext = null
  }
}
