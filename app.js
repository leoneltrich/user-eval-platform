// Interactive Quiz Questions Array
const QUIZ_QUESTIONS = [
  {
    question: "Which Docker command lists only the active, running containers?",
    options: ["docker list", "docker ps", "docker show-active", "docker containers"],
    answer: 1,
    explanation: "Hint: Try running 'docker ps' in the sandboxed terminal on the right!"
  },
  {
    question: "Which runtime does gVisor use to run processes inside a secure user-space kernel?",
    options: ["runc", "kata-runtime", "runsc", "crun"],
    answer: 2,
    explanation: "Hint: We specified runtime='runsc' in our Docker configuration."
  },
  {
    question: "What is the default configuration file name used by Docker Compose?",
    options: ["docker-compose.json", "compose.config", "docker-compose.yml", "container-compose.conf"],
    answer: 2,
    explanation: "Hint: Compose standard files end with .yml or .yaml extensions."
  },
  {
    question: "Which Linux command displays the current absolute path of the working directory?",
    options: ["pwd", "dir", "cd", "path"],
    answer: 0,
    explanation: "Hint: 'Print Working Directory' - type 'pwd' in your terminal."
  }
];

let currentQuestionIndex = 0;
let score = 0;
let selectedOptionIndex = null;
let terminalSessionId = null;
let socket = null;
let term = null;
let fitAddon = null;

// DOM Elements
let quizCard, connectionStatus, statusText;

let userEmail = null;

document.addEventListener('DOMContentLoaded', () => {
    // Cache UI elements
    quizCard = document.getElementById('quiz-card');
    connectionStatus = document.getElementById('connection-status');
    statusText = document.getElementById('status-text');

    // Initialize Quiz
    initQuiz();
    
    // Check or Prompt for user email before starting session
    checkUserEmail();
});

// Quiz Interface Handlers
function initQuiz() {
    renderQuestion();
}

function renderQuestion() {
    if (currentQuestionIndex >= QUIZ_QUESTIONS.length) {
        renderResults();
        return;
    }
    
    selectedOptionIndex = null;
    const questionData = QUIZ_QUESTIONS[currentQuestionIndex];
    const progressPercent = (currentQuestionIndex / QUIZ_QUESTIONS.length) * 100;
    
    quizCard.innerHTML = `
        <div class="progress-container">
            <div class="progress-bar" style="width: ${progressPercent}%"></div>
        </div>
        <div class="quiz-question-number">Question ${currentQuestionIndex + 1} of ${QUIZ_QUESTIONS.length}</div>
        <h2 class="quiz-question-text" id="question-text">${questionData.question}</h2>
        <div class="options-container">
            ${questionData.options.map((option, idx) => `
                <button class="option-btn" data-index="${idx}" id="option-${idx}">
                    <span>${option}</span>
                    <div class="option-marker">${String.fromCharCode(65 + idx)}</div>
                </button>
            `).join('')}
        </div>
        <div class="quiz-footer">
            <button class="btn btn-secondary" id="hint-btn">Hint</button>
            <button class="btn btn-primary" id="next-btn" disabled>Next Question</button>
        </div>
    `;
    
    // Option Selection
    const optionBtns = quizCard.querySelectorAll('.option-btn');
    optionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (selectedOptionIndex !== null) return; // Force single selection
            
            selectedOptionIndex = parseInt(btn.getAttribute('data-index'));
            
            // Mark selection
            btn.classList.add('selected');
            
            const isCorrect = selectedOptionIndex === questionData.answer;
            if (isCorrect) {
                btn.classList.remove('selected');
                btn.classList.add('correct');
                score++;
            } else {
                btn.classList.remove('selected');
                btn.classList.add('incorrect');
                // Auto-highlight the correct option
                optionBtns[questionData.answer].classList.add('correct');
            }
            
            // Enable next button navigation
            document.getElementById('next-btn').removeAttribute('disabled');
        });
    });
    
    // Navigation Action
    document.getElementById('next-btn').addEventListener('click', () => {
        currentQuestionIndex++;
        renderQuestion();
    });
    
    // Hint Action
    document.getElementById('hint-btn').addEventListener('click', () => {
        alert(questionData.explanation);
    });
}

function renderResults() {
    const finalProgressPercent = 100;
    quizCard.innerHTML = `
        <div class="progress-container">
            <div class="progress-bar" style="width: ${finalProgressPercent}%"></div>
        </div>
        <div class="results-card">
            <div class="score-circle">
                <div class="score-num">${score}</div>
                <div class="score-total">out of ${QUIZ_QUESTIONS.length}</div>
            </div>
            <h2>Quiz Complete!</h2>
            <p class="feedback-text">
                ${score === QUIZ_QUESTIONS.length 
                  ? 'Outstanding! You answered all questions correctly.' 
                  : 'Well done! Keep practicing your shell skills.'}
            </p>
            <button class="btn btn-primary" id="restart-btn">Restart Quiz</button>
        </div>
    `;
    
    document.getElementById('restart-btn').addEventListener('click', () => {
        currentQuestionIndex = 0;
        score = 0;
        initQuiz();
    });
}

// Sandbox Provisioning & WebSocket Bridge Setup
async function initTerminalSession() {
    updateStatus('connecting', 'Provisioning Sandbox...');
    
    // Initialize xterm.js
    term = new Terminal({
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 14,
        cursorBlink: true,
        theme: {
            background: '#0f0f15',
            foreground: '#d4d4d8',
            cursor: '#a78bfa',
            selectionBackground: 'rgba(167, 139, 250, 0.3)'
        }
    });
    
    fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();
    
    // Resize notification handler
    window.addEventListener('resize', () => {
        fitAddon.fit();
        sendResize(term.cols, term.rows);
    });

    console.log('=== Ephemeral Sandbox Orchestrator ===');
    console.log('Contacting container allocation manager...');

    try {
        const origin = window.location.origin;
        // Provision the gVisor sandbox container
        const response = await fetch(`${origin}/api/start-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`Start-session returned HTTP status ${response.status}`);
        }
        
        const data = await response.json();
        terminalSessionId = data.session_id;
        
        console.log(`Container started. Session ID: ${terminalSessionId}`);
        console.log('Establishing WebSocket proxy tunnel...');
        
        // Connect websocket proxy
        connectWebSocket(terminalSessionId);
        
    } catch (err) {
        term.writeln(`\x1b[31mInitialization Error: ${err.message}\x1b[0m`);
        updateStatus('disconnected', 'Sandbox Error');
    }
}

function connectWebSocket(sessionId) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/${sessionId}`;
    
    socket = new WebSocket(wsUrl, 'tty');
    socket.binaryType = 'arraybuffer';
    
    socket.onopen = () => {
        updateStatus('connected', 'Connected');
        console.log('Secure tunnel connected. Spawning shell...');
        
        // Send ttyd initial Auth packet: raw JSON (starts with '{' matching JSON_DATA opcode)
        socket.send(JSON.stringify({ AuthToken: "" }));
        
        // Send initial resize packet: '1' prefix
        sendResize(term.cols, term.rows);
    };
    
    socket.onmessage = (event) => {
        handleServerMessage(event.data);
    };
    
    socket.onclose = () => {
        updateStatus('disconnected', 'Disconnected');
        term.writeln('\r\n\x1b[31mSandbox connection lost. Container has been vaporized.\x1b[0m');
    };
    
    socket.onerror = (err) => {
        console.error('WebSocket Error:', err);
    };
    
    // Intercept client keystrokes: prefix with '0' (ttyd input packet type)
    term.onData(data => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send('0' + data);
        }
    });

    // Handle binary input pasting: prefix with '0'
    term.onBinary(data => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            const buffer = new Uint8Array(data.length + 1);
            buffer[0] = 48; // ASCII for '0'
            for (let i = 0; i < data.length; i++) {
                buffer[i + 1] = data.charCodeAt(i);
            }
            socket.send(buffer);
        }
    });
}

function handleServerMessage(data) {
    if (typeof data === 'string') {
        const type = data.charAt(0);
        const payload = data.slice(1);
        
        if (type === '0') {
            term.write(payload);
        }
    } else if (data instanceof ArrayBuffer) {
        const arr = new Uint8Array(data);
        const type = String.fromCharCode(arr[0]);
        const payload = arr.subarray(1);
        
        if (type === '0') {
            term.write(payload);
        }
    }
}

function sendResize(cols, rows) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send('1' + JSON.stringify({ columns: cols, rows: rows }));
    }
}

function updateStatus(status, label) {
    connectionStatus.className = `badge ${status}`;
    let displayLabel = "Not Connected";
    if (status === 'connected') {
        displayLabel = "Connected";
    } else if (status === 'connecting') {
        displayLabel = "Connecting";
    }
    statusText.textContent = displayLabel;
}

// User Email Check & Modal Handlers
function checkUserEmail() {
    const emailModal = document.getElementById('email-modal');
    const emailForm = document.getElementById('email-form');
    const emailInput = document.getElementById('email-input');
    const emailDisplay = document.getElementById('user-email-display');

    // 1. Try to extract from URL params (?email=...)
    const urlParams = new URLSearchParams(window.location.search);
    let email = urlParams.get('email');

    if (email) {
        // Clean URL to avoid keeping the query parameter in location bar
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    } else {
        // 2. Fallback to localStorage
        email = localStorage.getItem('user_email');
    }

    if (email && validateEmail(email)) {
        setUserEmail(email);
    } else {
        // 3. Show prompt modal
        emailModal.style.display = 'flex';
        emailForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const enteredEmail = emailInput.value.trim();
            if (validateEmail(enteredEmail)) {
                emailModal.style.display = 'none';
                setUserEmail(enteredEmail);
            } else {
                alert('Please enter a valid email address.');
            }
        });
    }

    // Clicking the email display resets email preference (acting as logout/change email)
    emailDisplay.addEventListener('click', () => {
        localStorage.removeItem('user_email');
        userEmail = null;
        emailDisplay.textContent = '';
        
        // Disconnect and clean up current session
        if (socket) {
            socket.close();
        }
        if (term) {
            term.dispose();
            term = null;
            document.getElementById('terminal').innerHTML = '';
        }
        
        emailInput.value = '';
        emailModal.style.display = 'flex';
    });
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+$/;
    return re.test(email);
}

function setUserEmail(email) {
    userEmail = email;
    localStorage.setItem('user_email', email);
    
    // Update terminal title display with formatted email
    const emailDisplay = document.getElementById('user-email-display');
    emailDisplay.textContent = `• ${email}`;
    
    // Provision sandbox terminal now that email is configured
    initTerminalSession();
}
