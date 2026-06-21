// Global State Variables
let tasks = [];
let surveyQuestions = [];
let currentTaskIndex = 0;
let currentQuestionIndex = 0;
let quizMode = 'tasks'; // 'tasks' | 'survey' | 'complete'
let surveyAnswers = []; // to store collected survey responses locally in-memory
let introduction = null;
let hasSeenIntro = false;


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

    // Start active segment tracker (visibility and focus/blur)
    initVisibilityTracker();
});

// Quiz / Task Interface Handlers
async function initQuiz() {
    try {
        const response = await fetch('/api/tasks');
        if (!response.ok) {
            throw new Error(`Failed to load tasks: HTTP status ${response.status}`);
        }
        const data = await response.json();
        if (data && data.tasks) {
            tasks = data.tasks;
            surveyQuestions = data.questions || [];
            introduction = data.introduction || null;
        } else {
            tasks = data || [];
            surveyQuestions = [];
            introduction = null;
        }
        
        if (currentTaskIndex === 0 && introduction && !hasSeenIntro) {
            quizMode = 'introduction';
            renderIntroduction();
        } else {
            renderTask();
        }
    } catch (err) {
        console.error("Error loading tasks configuration:", err);
        quizCard.innerHTML = `<p style="color: #ef4444; font-weight: bold;">Error loading tasks: ${err.message}</p>`;
    }
}


// Telemetry and Progress Sync Helpers
async function saveProgress(finalizeTaskId = null) {
    try {
        await fetch('/api/progress', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: terminalSessionId,
                current_task_index: currentTaskIndex,
                current_question_index: currentQuestionIndex,
                finalize_task_id: finalizeTaskId
            })
        });
    } catch (err) {
        console.error("Failed to save progress:", err);
    }
}

function sendTelemetryEvent(eventType, taskId) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const payload = JSON.stringify({
            type: "telemetry_event",
            event_type: eventType,
            task_id: taskId
        });
        socket.send('2' + payload);
    }
}

function renderIntroduction() {
    if (!introduction) {
        quizMode = 'tasks';
        renderTask();
        return;
    }

    quizCard.innerHTML = `
        <div class="progress-container">
            <div class="progress-bar" style="width: 0%"></div>
        </div>
        <div class="quiz-question-number">Introduction</div>
        <h2 class="quiz-question-text" id="question-text">${introduction.title}</h2>
        
        <p class="feedback-text" style="line-height: 1.6; margin-bottom: 24px;">${introduction.content}</p>

        <div class="quiz-footer" style="justify-content: flex-end; margin-top: auto;">
            <button class="btn btn-primary" id="start-evaluation-btn">Start Evaluation</button>
        </div>
    `;

    document.getElementById('start-evaluation-btn').addEventListener('click', () => {
        hasSeenIntro = true;
        sendTelemetryEvent('evaluation_start', 1);
        quizMode = 'tasks';
        renderTask();
    });
}

function renderTask() {
    if (tasks.length === 0) {
        quizCard.innerHTML = '<p>Loading tasks configuration...</p>';
        return;
    }

    if (currentTaskIndex >= tasks.length) {
        quizMode = 'last_solution';
        // Render completion page with previous solution button and questionnaire trigger
        quizCard.innerHTML = `
            <div class="progress-container">
                <div class="progress-bar" style="width: 100%"></div>
            </div>
            <div class="quiz-question-number">All Simulation Tasks Completed!</div>
            <h2 class="quiz-question-text">Congratulations!</h2>
            
            <p class="feedback-text">You have successfully completed all simulation scenarios. Before proceeding to the survey questionnaire, you can review the solution for the final task.</p>

            <div id="solution-container"></div>

            <div class="quiz-footer">
                <button class="btn btn-secondary" id="solution-btn">Show Previous Solution</button>
                <button class="btn btn-primary" id="start-survey-btn">Start Questionnaire</button>
            </div>
        `;
        
        const solutionBtn = document.getElementById('solution-btn');
        const solutionContainer = document.getElementById('solution-container');
        const prevTaskData = tasks[tasks.length - 1]; // Task 3

        solutionBtn.addEventListener('click', () => {
            if (solutionContainer.innerHTML === '') {
                // Log view_solution telemetry event
                sendTelemetryEvent('view_solution', prevTaskData.id);

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

        document.getElementById('start-survey-btn').addEventListener('click', async () => {
            if (surveyQuestions && surveyQuestions.length > 0) {
                quizMode = 'survey';
                renderSurvey();
            } else {
                quizMode = 'complete';
                renderResults();
            }
        });
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
        
        <p class="feedback-text">${taskData.scenario}</p>

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
              : ''
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
            
            // Log copy_command telemetry event
            sendTelemetryEvent('copy_command', taskData.id);

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
            
            // Log copy_command telemetry event
            sendTelemetryEvent('copy_command', taskData.id);

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
                // Log view_solution telemetry event
                sendTelemetryEvent('view_solution', prevTaskData.id);

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
    document.getElementById('next-btn').addEventListener('click', async () => {
        const completedTaskId = taskData.id;
        sendTelemetryEvent('task_complete', completedTaskId);
        currentTaskIndex++;
        await saveProgress(completedTaskId);
        renderTask();
    });
}

function renderSurvey() {
    if (currentQuestionIndex >= surveyQuestions.length) {
        quizMode = 'complete';
        renderResults();
        return;
    }

    const questionData = surveyQuestions[currentQuestionIndex];
    const progressPercent = (currentQuestionIndex / surveyQuestions.length) * 100;
    
    let optionsHtml = '';
    if (questionData.type === 'choice') {
        optionsHtml = `
            <div class="options-container">
                ${questionData.options.map((option, idx) => `
                    <button class="option-btn" data-index="${idx}">
                        <span>${option}</span>
                        <span class="option-marker">${String.fromCharCode(65 + idx)}</span>
                    </button>
                `).join('')}
            </div>
        `;
    } else if (questionData.type === 'text') {
        optionsHtml = `
            <div class="survey-content-wrapper">
                <textarea class="feedback-textarea" id="feedback-input" placeholder="Type your response here..." maxlength="1000"></textarea>
            </div>
        `;
    }

    const isLastQuestion = currentQuestionIndex === surveyQuestions.length - 1;
    const nextBtnText = isLastQuestion ? 'Finish' : 'Next Question';

    quizCard.innerHTML = `
        <div class="progress-container">
            <div class="progress-bar" style="width: ${progressPercent}%"></div>
        </div>
        <div class="quiz-question-number">Question ${currentQuestionIndex + 1} of ${surveyQuestions.length}</div>
        <h2 class="quiz-question-text" id="question-text">${questionData.text}</h2>
        
        ${optionsHtml}

        <div class="quiz-footer" style="justify-content: flex-end;">
            <button class="btn btn-primary" id="next-question-btn" disabled>${nextBtnText}</button>
        </div>
    `;

    const nextBtn = document.getElementById('next-question-btn');

    if (questionData.type === 'choice') {
        let selectedIndex = null;
        const optionBtns = quizCard.querySelectorAll('.option-btn');
        optionBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                optionBtns.forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedIndex = parseInt(btn.getAttribute('data-index'));
                nextBtn.removeAttribute('disabled');
            });
        });

        nextBtn.addEventListener('click', async () => {
            if (selectedIndex !== null) {
                const answerText = questionData.options[selectedIndex];
                surveyAnswers.push({
                    questionId: questionData.id,
                    question: questionData.text,
                    type: 'choice',
                    answer: answerText,
                    optionIndex: selectedIndex
                });
                console.log("Survey answers updated:", surveyAnswers);
                
                // Save survey response to database
                try {
                    await fetch('/api/survey/response', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: terminalSessionId,
                            question_id: questionData.id,
                            question_text: questionData.text,
                            response_type: 'choice',
                            response_value: answerText,
                            option_index: selectedIndex
                        })
                    });
                } catch (err) {
                    console.error("Failed to save survey answer:", err);
                }

                currentQuestionIndex++;
                await saveProgress();
                renderSurvey();
            }
        });
    } else if (questionData.type === 'text') {
        const textarea = document.getElementById('feedback-input');
        textarea.addEventListener('input', () => {
            if (textarea.value.trim().length > 0) {
                nextBtn.removeAttribute('disabled');
            } else {
                nextBtn.setAttribute('disabled', 'true');
            }
        });

        nextBtn.addEventListener('click', async () => {
            const val = textarea.value.trim().substring(0, 1000);
            if (val.length > 0) {
                surveyAnswers.push({
                    questionId: questionData.id,
                    question: questionData.text,
                    type: 'text',
                    answer: val
                });
                console.log("Survey answers updated:", surveyAnswers);

                // Save survey response to database
                try {
                    await fetch('/api/survey/response', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: terminalSessionId,
                            question_id: questionData.id,
                            question_text: questionData.text,
                            response_type: 'text',
                            response_value: val,
                            option_index: null
                        })
                    });
                } catch (err) {
                    console.error("Failed to save survey answer:", err);
                }

                currentQuestionIndex++;
                await saveProgress();
                renderSurvey();
            }
        });
    }
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

    // Print final collected answers to console (in-memory only)
    console.log("=== FINAL SURVEY RESPONSES ===");
    console.log(JSON.stringify(surveyAnswers, null, 2));

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
            <p class="feedback-text">You have successfully completed all simulation scenarios. Your progress and environment telemetry have been securely saved.</p>
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
            let errMsg = `Start-session returned HTTP status ${response.status}`;
            try {
                const errData = await response.json();
                if (errData && errData.detail) {
                    errMsg = errData.detail;
                }
            } catch (e) {}
            throw new Error(errMsg);
        }
        
        const data = await response.json();
        terminalSessionId = data.session_id;
        
        // Hide modal and show evaluation interface
        const emailModal = document.getElementById('email-modal');
        if (emailModal) {
            emailModal.style.display = 'none';
        }
        document.getElementById('main-workspace').style.display = 'flex';
        document.querySelector('.main-header').style.display = 'flex';
        
        // Resume task and question indices loaded from database
        currentTaskIndex = data.current_task_index || 0;
        currentQuestionIndex = data.current_question_index || 0;

        // If tasks config is already loaded, immediately update UI to correct state
        if (tasks.length > 0) {
            if (currentTaskIndex >= tasks.length) {
                quizMode = 'survey';
                renderSurvey();
            } else if (currentTaskIndex === 0 && introduction && !hasSeenIntro) {
                quizMode = 'introduction';
                renderIntroduction();
            } else {
                quizMode = 'tasks';
                renderTask();
            }
        }
        
        if (quizMode !== 'complete') {
            console.log(`Container started. Session ID: ${terminalSessionId}`);
            console.log('Establishing WebSocket proxy tunnel...');
            
            // Connect websocket proxy
            connectWebSocket(terminalSessionId);
        } else {
            console.log("Evaluation already completed. Skipping WebSocket tunnel.");
        }
        
    } catch (err) {
        console.error("Initialization Error:", err.message);
        
        // Clear local storage and email session
        localStorage.removeItem('user_email');
        userEmail = null;
        document.getElementById('user-email-display').textContent = '';
        
        // Show validation error on the login modal directly
        resetModalState(err.message);
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
        if (term) {
            sendResize(term.cols, term.rows);
        }
    };
    
    socket.onmessage = (event) => {
        handleServerMessage(event.data);
    };
    
    socket.onclose = () => {
        updateStatus('disconnected', 'Disconnected');
        if (term) {
            term.writeln('\r\n\x1b[31mSandbox connection lost. Container has been vaporized.\x1b[0m');
        }
    };
    
    socket.onerror = (err) => {
        console.error('WebSocket Error:', err);
    };
    
    // Intercept client keystrokes: prefix with '0' (ttyd input packet type)
    if (term) {
        term.onData(data => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                const safeData = data.length > 8192 ? data.substring(0, 8192) : data;
                socket.send('0' + safeData);
            }
        });

        // Handle binary input pasting: prefix with '0'
        term.onBinary(data => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                const safeLength = Math.min(data.length, 8192);
                const buffer = new Uint8Array(safeLength + 1);
                buffer[0] = 48; // ASCII for '0'
                for (let i = 0; i < safeLength; i++) {
                    buffer[i + 1] = data.charCodeAt(i);
                }
                socket.send(buffer);
            }
        });
    }
}

function handleServerMessage(data) {
    if (!term) return;
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

function showModalLoading(email) {
    const emailModal = document.getElementById('email-modal');
    const emailInput = document.getElementById('email-input');
    const submitBtn = document.getElementById('submit-email-btn');
    const errorMsg = document.getElementById('email-error-msg');
    
    if (errorMsg) errorMsg.style.display = 'none';
    if (emailInput) {
        emailInput.value = email;
        emailInput.disabled = true;
    }
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Connecting...';
    }
    if (emailModal) {
        emailModal.style.display = 'flex';
    }
}

function resetModalState(error = null) {
    const emailModal = document.getElementById('email-modal');
    const emailInput = document.getElementById('email-input');
    const submitBtn = document.getElementById('submit-email-btn');
    const errorMsg = document.getElementById('email-error-msg');
    
    if (emailInput) {
        emailInput.disabled = false;
    }
    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start Session';
    }
    if (errorMsg) {
        if (error) {
            errorMsg.textContent = error;
            errorMsg.style.display = 'block';
        } else {
            errorMsg.style.display = 'none';
        }
    }
    if (emailModal) {
        emailModal.style.display = 'flex';
    }
}

// User Email Check & Modal Handlers
function checkUserEmail() {
    const emailModal = document.getElementById('email-modal');
    const emailForm = document.getElementById('email-form');
    const emailInput = document.getElementById('email-input');
    const emailDisplay = document.getElementById('user-email-display');

    // Register submit listener unconditionally so form submissions are always handled by JS
    emailForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const enteredEmail = emailInput.value.trim();
        if (validateEmail(enteredEmail)) {
            showModalLoading(enteredEmail);
            setUserEmail(enteredEmail);
        } else {
            alert('Please enter a valid email address.');
        }
    });

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
        showModalLoading(email);
        setUserEmail(email);
    } else {
        // 3. Show prompt modal
        resetModalState(null);
    }

    // Clicking the email display resets email preference (acting as logout/change email)
    emailDisplay.addEventListener('click', () => {
        localStorage.removeItem('user_email');
        userEmail = null;
        emailDisplay.textContent = '';
        
        // Hide evaluation interface
        document.getElementById('main-workspace').style.display = 'none';
        document.querySelector('.main-header').style.display = 'none';
        
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
        resetModalState(null);
    });
}

function validateEmail(email) {
    if (!email || email.length > 254) return false;
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

// Tab visibility and focus handlers to track active segment timings
function initVisibilityTracker() {
    let activeState = true;

    function handleVisibilityChange() {
        const isVisible = document.visibilityState === 'visible';
        updateActiveState(isVisible);
    }

    function handleFocus() {
        updateActiveState(true);
    }

    function handleBlur() {
        updateActiveState(false);
    }

    function updateActiveState(newState) {
        if (newState === activeState) return;
        activeState = newState;
        
        if (socket && socket.readyState === WebSocket.OPEN) {
            // Task IDs are 1-based (Task 1 has index 0). If in survey mode, pass 0.
            const taskId = (quizMode === 'tasks') ? (tasks[currentTaskIndex]?.id || 0) : 0;
            const payload = JSON.stringify({
                type: activeState ? "tab_active" : "tab_inactive",
                task_id: taskId
            });
            socket.send('2' + payload);
            console.log(`Visibility signal sent: ${activeState ? 'active' : 'inactive'} for task ${taskId}`);
        }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
}
