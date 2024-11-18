// DOM Elements
const startRecordingBtn = document.getElementById('startRecording');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKey');
const liveTranscription = document.getElementById('liveTranscription');
const formattedNotes = document.getElementById('formattedNotes');
const statusElement = document.getElementById('status');
const loadingIndicator = document.querySelector('.loading-indicator');
const waveformVisualizer = document.getElementById('waveform');
const recordingTimer = document.getElementById('recordingTimer');

// State management
let isRecording = false;
let recognition = null;
let audioContext = null;
let analyser = null;
let mediaStream = null;
let startTime = null;
let timerInterval = null;

// Initialize Web Speech API
function initializeSpeechRecognition() {
    window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new window.SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
        const transcript = Array.from(event.results)
            .map(result => result[0].transcript)
            .join('');
        
        liveTranscription.textContent = transcript;
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        updateStatus('Error: ' + event.error, 'error');
    };
}

// Initialize Audio Context and Waveform Visualizer
async function initializeAudioVisualizer() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        
        const source = audioContext.createMediaStreamSource(mediaStream);
        source.connect(analyser);
        
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function drawWaveform() {
            if (!isRecording) return;
            
            requestAnimationFrame(drawWaveform);
            analyser.getByteTimeDomainData(dataArray);

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = waveformVisualizer.clientWidth;
            canvas.height = waveformVisualizer.clientHeight;

            ctx.fillStyle = 'var(--bg-secondary)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.lineWidth = 2;
            ctx.strokeStyle = 'var(--accent-color)';
            ctx.beginPath();

            const sliceWidth = canvas.width / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * canvas.height) / 2;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }

                x += sliceWidth;
            }

            ctx.lineTo(canvas.width, canvas.height / 2);
            ctx.stroke();

            waveformVisualizer.innerHTML = '';
            waveformVisualizer.appendChild(canvas);
        }

        drawWaveform();
    } catch (error) {
        console.error('Error initializing audio visualizer:', error);
        updateStatus('Error accessing microphone', 'error');
    }
}

// API Key Management
function saveApiKey() {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
        const encryptedKey = encryptApiKey(apiKey);
        localStorage.setItem('geminiApiKey', encryptedKey);
        updateStatus('API key saved successfully', 'success');
        apiKeyInput.value = ''; // Clear the input for security
    } else {
        updateStatus('Please enter a valid API key', 'error');
    }
}

// Add this new function to check and request permissions
async function checkAndRequestPermissions() {
    try {
        // First check if the browser supports permissions API
        if (navigator.permissions && navigator.permissions.query) {
            const result = await navigator.permissions.query({ name: 'microphone' });
            if (result.state === 'denied') {
                updateStatus('Microphone access denied. Please enable it in your browser settings.', 'error');
                return false;
            }
        }
        
        // Directly try to get the media stream
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Don't stop the stream here, as we'll need it for recording
        return true;
    } catch (error) {
        console.error('Permission error:', error);
        updateStatus('Microphone access denied. Please enable it in your browser settings.', 'error');
        return false;
    }
}

// Handle recording state
async function toggleRecording() {
    if (!isRecording) {
        try {
            const hasPermission = await checkAndRequestPermissions();
            if (!hasPermission) {
                return;
            }

            await initializeAudioVisualizer();
            recognition.start();
            isRecording = true;
            startRecordingBtn.classList.add('active');
            startRecordingBtn.innerHTML = '<i class="fas fa-stop"></i><span>Stop Listening</span>';
            updateStatus('Recording...', 'recording');
            
            startTime = Date.now();
            recordingTimer.classList.add('active');
            timerInterval = setInterval(updateTimer, 1000);
            updateTimer();
        } catch (error) {
            console.error('Error starting recording:', error);
            updateStatus('Error starting recording', 'error');
        }
    } else {
        stopRecording();
    }
}

function stopRecording() {
    recognition.stop();
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }
    isRecording = false;
    startRecordingBtn.classList.remove('active');
    startRecordingBtn.innerHTML = '<i class="fas fa-microphone"></i><span>Start Listening</span>';
    updateStatus('Processing...', 'processing');
    
    clearInterval(timerInterval);
    recordingTimer.classList.remove('active');
    recordingTimer.textContent = '00:00';
    startTime = null;
    
    processTranscription(liveTranscription.textContent);
}

// Process transcription with Gemini API
async function processTranscription(text) {
    try {
        loadingIndicator.classList.remove('hidden');
        
        const encryptedKey = localStorage.getItem('geminiApiKey');
        if (!encryptedKey) {
            throw new Error('Please save your API key first');
        }

        const apiKey = decryptApiKey(encryptedKey);
        const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${apiKey}`;

        const prompt = `Please create well-organized, comprehensive notes from the following transcription. 
        Focus only on the important information and ignore any background chatter or irrelevant details.
        Use proper formatting:
        - Use headers (##) for main topics
        - Use bullet points for key points
        - Use **bold** for emphasis on important terms or concepts
        - Use *italics* for definitions or explanations
        - Use numbered lists for sequential steps or processes
        
        Here's the transcription:
        ${text}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(
                errorData.error?.message || 
                `HTTP error! status: ${response.status}`
            );
        }

        const data = await response.json();
        
        if (data.candidates && data.candidates[0].content) {
            const formattedText = data.candidates[0].content.parts[0].text;
            
            // Convert Markdown to HTML
            const formattedHtml = formattedText
                // Headers
                .replace(/##\s+(.*?)(\n|$)/g, '<h3>$1</h3>')
                // Bold
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                // Italic
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                // Bullet points
                .replace(/^-\s+(.*)$/gm, '• $1')
                // Numbered lists (preserve numbers)
                .replace(/^\d+\.\s+(.*)$/gm, '$&')
                // Line breaks
                .replace(/\n/g, '<br>');
            
            formattedNotes.innerHTML = formattedHtml;
            updateStatus('Ready', 'success');
        } else {
            throw new Error('Invalid response format');
        }
    } catch (error) {
        console.error('Error processing with Gemini:', error);
        updateStatus('Error: ' + error.message, 'error');
        formattedNotes.innerHTML = `<div style="color: var(--error-color);">
            ${error.message}. Please check your API key and try again.
        </div>`;
    } finally {
        loadingIndicator.classList.add('hidden');
    }
}

// Update status display
function updateStatus(message, type) {
    statusElement.textContent = message;
    statusElement.className = `status-${type}`;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', initializeSpeechRecognition);
startRecordingBtn.addEventListener('click', toggleRecording);
saveApiKeyBtn.addEventListener('click', saveApiKey);

// Load saved API key if exists
const savedApiKey = localStorage.getItem('geminiApiKey');
if (savedApiKey) {
    apiKeyInput.value = savedApiKey;
}

function updateTimer() {
    const currentTime = Date.now();
    const elapsedTime = new Date(currentTime - startTime);
    const minutes = elapsedTime.getMinutes().toString().padStart(2, '0');
    const seconds = elapsedTime.getSeconds().toString().padStart(2, '0');
    recordingTimer.textContent = `${minutes}:${seconds}`;
}

// Add these encryption functions
function encryptApiKey(apiKey) {
    // Simple encryption for demo (not secure for production)
    return btoa(apiKey.split('').reverse().join(''));
}

function decryptApiKey(encryptedKey) {
    // Simple decryption for demo (not secure for production)
    return atob(encryptedKey).split('').reverse().join('');
}
