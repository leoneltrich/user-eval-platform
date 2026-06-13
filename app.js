// Global State Variables
let tasks = [];
let currentTaskIndex = 0;
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

    // Initialize Quiz flow (fetch tasks from API first)
    initQuiz();
    
    // Check or Prompt for user email before starting session
    checkUserEmail();
});

// Quiz / Task Interface Handlers
async function initQuiz() {
    try {
        const response = await fetch('/api/tasks');
        if (!response.ok) {
            throw new Error(`Failed to load tasks: HTTP status ${response.status}`);
        }
        tasks = await response.json();
        renderTask();
    } catch (err) {
        console.error("Error loading tasks configuration:", err);
        quizCard.innerHTML = `<p style="color: #ef4444; font-weight: bold;">Error loading tasks: ${err.message}</p>`;
    }
}

function renderTask() {
    if (tasks.length === 0) {
        quizCard.innerHTML = '<p>Loading tasks configuration...</p>';
        return;
    }

    if (currentTaskIndex >= tasks.length) {
        renderResults();
        return;
    }
    
    const taskData = tasks[currentTaskIndex];
    const progressPercent = (currentTaskIndex / tasks.length) * 100;
    
    quizCard.innerHTML = `
        <div class="progress-container">
            <div class="progress-bar" style="width: ${progressPercent}%"></div>
        </div>
        <div class="quiz-question-number">Task ${currentTaskIndex + 1} of ${tasks.length}</div>
        <h2 class="quiz-question-text" id="question-text">${taskData.title}</h2>
        
        <p class="feedback-text" style="font-family: inherit; font-size: 1.05rem; text-align: left; opacity: 0.95; line-height: 1.5; margin-bottom: 20px;">
            ${taskData.scenario}
        </p>

        <div class="command-box">
            <div class="command-text" id="command-text">${taskData.command}</div>
            <button class="copy-btn" id="copy-btn">
                <span id="copy-btn-text">Copy</span>
            </button>
        </div>

        <div id="solution-container"></div>

        <div class="quiz-footer">
            ${currentTaskIndex > 0 
              ? `<button class="btn btn-secondary" id="solution-btn">Show Previous Solution</button>` 
              : `<div></div>`
            }
            <button class="btn btn-primary" id="next-btn">Next Task</button>
        </div>
    `;

    // Copy to clipboard handler
    const copyBtn = document.getElementById('copy-btn');
    const copyBtnText = document.getElementById('copy-btn-text');
    copyBtn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(taskData.command);
            copyBtn.classList.add('copied');
            copyBtnText.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtnText.textContent = 'Copy';
            }, 2000);
        } catch (err) {
            console.error('Failed to copy to clipboard:', err);
            // Fallback for browsers that block clipboard write
            const textArea = document.createElement("textarea");
            textArea.value = taskData.command;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            copyBtn.classList.add('copied');
            copyBtnText.textContent = 'Copied!';
            setTimeout(() => {
                copyBtn.classList.remove('copied');
                copyBtnText.textContent = 'Copy';
            }, 2000);
        }
    });

    // Toggle previous solution handler
    if (currentTaskIndex > 0) {
        const solutionBtn = document.getElementById('solution-btn');
        const solutionContainer = document.getElementById('solution-container');
        const prevTaskData = tasks[currentTaskIndex - 1];

        solutionBtn.addEventListener('click', () => {
            if (solutionContainer.innerHTML === '') {
                solutionContainer.innerHTML = `
                    <div class="solution-card">
                        <div class="solution-title">Previous Solution: ${prevTaskData.title}</div>
                        <div class="solution-text">${prevTaskData.solution}</div>
                    </div>
                `;
                solutionBtn.textContent = 'Hide Previous Solution';
                solutionBtn.classList.add('active');
            } else {
                solutionContainer.innerHTML = '';
                solutionBtn.textContent = 'Show Previous Solution';
                solutionBtn.classList.remove('active');
            }
        });
    }
    
    // Next Task Navigation Action
    document.getElementById('next-btn').addEventListener('click', () => {
        currentTaskIndex++;
        renderTask();
    });
}

function renderResults() {
    // 1. Add class "complete" to the main workspace container to trigger CSS transitions
    const workspace = document.getElementById('main-workspace');
    if (workspace) {
        workspace.classList.add('complete');
    }

    // 2. Safely close any active websocket connection and release resources
    if (socket) {
        socket.close();
    }
    if (term) {
        term.dispose();
        term = null;
        document.getElementById('terminal').innerHTML = '';
    }

    // 3. Render the feedback screen thanking the user
    const finalProgressPercent = 100;
    quizCard.innerHTML = `
        <div class="progress-container">
            <div class="progress-bar" style="width: ${finalProgressPercent}%"></div>
        </div>
        <div class="results-card">
            <div class="checkmark-wrapper">
                <svg class="checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                    <circle class="checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
                    <path class="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                </svg>
            </div>
            <div class="results-badge">Evaluation Completed</div>
            <h2 class="results-title">Thank You!</h2>
            <p class="feedback-text">
                You have successfully completed all simulation scenarios. Your progress and environment telemetry have been securely saved.
            </p>
            <div class="completion-banner">
                <svg class="lock-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                <span>You can now safely close this tab.</span>
            </div>
        </div>
    `;
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail })
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
