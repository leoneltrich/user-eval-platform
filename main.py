import logging
import asyncio
from typing import Optional
from fastapi import FastAPI, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import websockets
from container_manager import ContainerManager
from db_manager import DatabaseManager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orchestrator.main")

# Instantiate the container manager and database manager
container_manager = ContainerManager()
db_manager = DatabaseManager()

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB connection pool and schemas
    await db_manager.initialize()
    yield
    # Cleanup DB connection pool
    await db_manager.close()
    logger.info("Cleaning up sandbox network on shutdown...")
    container_manager.clean_up_network()

app = FastAPI(title="Quiz Terminal Orchestrator API", lifespan=lifespan)

# Setup CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SessionStartRequest(BaseModel):
    email: str = Field(..., max_length=254)

class SessionStartResponse(BaseModel):
    session_id: str
    status: str
    current_task_index: int
    current_question_index: int

@app.post("/api/start-session", response_model=SessionStartResponse, status_code=status.HTTP_201_CREATED)
async def start_session(request: SessionStartRequest):
    """Endpoint to trigger the initialization of a new sandboxed container session."""
    try:
        # 1. Compute SHA-256 hash of the email address (normalize to lowercase first)
        import hashlib
        email_hash = hashlib.sha256(request.email.lower().strip().encode()).hexdigest()
        
        # Fetch or create the user in the database to load progress indices using the hash
        user_data = await db_manager.get_or_create_user(email_hash)
        
        # Generate an anonymous, consistent username from the email hash
        username = f"user-{email_hash[:8]}"
        
        # 2. Pass username and the email hash (never the raw email) to the container session
        session = container_manager.create_session(username=username, email=email_hash)
        
        return SessionStartResponse(
            session_id=session.session_id, 
            status="started",
            current_task_index=user_data["current_task_index"],
            current_question_index=user_data["current_question_index"]
        )
    except Exception as e:
        logger.error(f"Failed to start session: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initialize terminal session: {str(e)}"
        )

class ProgressUpdateRequest(BaseModel):
    session_id: str
    current_task_index: int
    current_question_index: int
    finalize_task_id: Optional[int] = None

@app.post("/api/progress")
async def update_progress(request: ProgressUpdateRequest):
    """Updates the user progress indices and finalizes a completed task duration."""
    try:
        session = container_manager.get_session(request.session_id)
        if not session:
            raise HTTPException(status_code=400, detail="Invalid session ID")
        email_hash = session.get("email")
        if not email_hash:
            raise HTTPException(status_code=400, detail="No email hash associated with session")
            
        await db_manager.update_user_progress(
            email_hash=email_hash,
            current_task_index=request.current_task_index,
            current_question_index=request.current_question_index
        )
        if request.finalize_task_id is not None:
            await db_manager.finalize_task(email_hash, request.finalize_task_id)
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update progress for session {request.session_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update progress: {str(e)}"
        )

class SurveyResponseRequest(BaseModel):
    session_id: str
    question_id: int
    question_text: str
    response_type: str
    response_value: str
    option_index: Optional[int] = None

@app.post("/api/survey/response")
async def save_survey_response(request: SurveyResponseRequest):
    """Saves user's response to a specific survey questionnaire question."""
    try:
        session = container_manager.get_session(request.session_id)
        if not session:
            raise HTTPException(status_code=400, detail="Invalid session ID")
        email_hash = session.get("email")
        if not email_hash:
            raise HTTPException(status_code=400, detail="No email hash associated with session")

        await db_manager.save_survey_response(
            email_hash=email_hash,
            question_id=request.question_id,
            question_text=request.question_text,
            response_type=request.response_type,
            response_value=request.response_value,
            option_index=request.option_index
        )
        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save survey response for session {request.session_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save survey response: {str(e)}"
        )


@app.get("/api/admin/export")
async def export_telemetry_report(token: str):
    """
    Endpoint to retrieve an encrypted, self-decrypting HTML report of all telemetry data.
    Requires a valid admin authentication token.
    """
    import config
    import json
    import os
    import base64
    import secrets
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from fastapi.responses import HTMLResponse

    if not secrets.compare_digest(token, config.ADMIN_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized admin token."
        )

    try:
        # 1. Fetch all telemetry records from DB
        data = await db_manager.get_all_telemetry_data()

        # Load tasks.json configuration to map task names and full questions
        try:
            with open("tasks.json", "r") as f:
                data["config"] = json.load(f)
        except Exception as ce:
            logger.warning(f"Could not load tasks.json for export config: {ce}")
            data["config"] = {"tasks": [], "questions": []}

        # 2. Serialize and Encrypt the payload using AES-GCM and PBKDF2
        serialized_data = json.dumps(data)

        salt = os.urandom(16)
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = kdf.derive(config.EXPORT_PASSWORD.encode())

        aesgcm = AESGCM(key)
        iv = os.urandom(12)
        ciphertext_with_tag = aesgcm.encrypt(iv, serialized_data.encode('utf-8'), None)

        b64_ciphertext = base64.b64encode(ciphertext_with_tag).decode('utf-8')
        b64_salt = base64.b64encode(salt).decode('utf-8')
        b64_iv = base64.b64encode(iv).decode('utf-8')

        # 3. Read report_template.html
        with open("report_template.html", "r") as f:
            template = f.read()

        # 4. Inject payload into the HTML report template
        html_content = template.replace("{{ ciphertext }}", b64_ciphertext)
        html_content = html_content.replace("{{ salt }}", b64_salt)
        html_content = html_content.replace("{{ iv }}", b64_iv)

        headers = {
            "Content-Disposition": "attachment; filename=telemetry_report.html"
        }
        return HTMLResponse(content=html_content, status_code=200, headers=headers)

    except Exception as e:
        logger.error(f"Failed to generate encrypted telemetry report: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate telemetry report: {str(e)}"
        )


@app.get("/api/sessions")
async def get_sessions():
    """Debug endpoint to list all currently running terminal sessions."""
    return container_manager.list_sessions()

@app.get("/api/tasks")
async def get_tasks():
    """Endpoint to retrieve the list of scenario tasks for the frontend component."""
    import json
    try:
        with open("tasks.json", "r") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load tasks: {str(e)}"
        )

@app.get("/")
async def get_index():
    """Serves the main frontend landing page."""
    return FileResponse("index.html")

@app.get("/style.css")
async def get_style():
    """Serves the global styling stylesheet."""
    return FileResponse("style.css")

@app.get("/app.js")
async def get_js():
    """Serves the primary frontend controller script."""
    return FileResponse("app.js")

@app.websocket("/ws/{session_id}")
async def websocket_proxy(websocket: WebSocket, session_id: str):
    """
    Establish a bidirectional websocket connection bridge between the client browser 
    and the sandboxed container ttyd instance. Includes a retry mechanism to handle 
    container boot latency.
    """
    # 1. Validate the length of the session ID first
    if not session_id or len(session_id) > 50:
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid session ID length")
        logger.warning(f"Rejected websocket request: Invalid session ID length")
        return

    # Look up the session ID to fetch the container's randomized host port
    session = container_manager.get_session(session_id)
    if not session:
        # Accept and immediately close the socket if the session is invalid
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid session ID")
        logger.warning(f"Rejected websocket request: Invalid session_id {session_id}")
        return

    port = session["port"]
    
    # Track active timer segment details
    import time
    email = session.get("email", "")
    last_active_start = time.time()
    is_tab_active = True
    
    # Initialize evaluation tracking state: inactive if user is on the first task (reading intro)
    is_eval_active = True
    if email:
        try:
            user_data = await db_manager.get_or_create_user(email)
            if user_data.get("current_task_index", 0) == 0:
                is_eval_active = False
        except Exception as e:
            logger.error(f"Failed to resolve initial tracking state for user {email}: {e}")

    
    # 2. Extract and negotiate the correct websocket subprotocol (usually 'tty')
    client_subprotocols = websocket.headers.get("sec-websocket-protocol", "")
    subprotocols = [s.strip() for s in client_subprotocols.split(",") if s.strip()]
    accepted_subprotocol = "tty" if "tty" in subprotocols else (subprotocols[0] if subprotocols else None)

    await websocket.accept(subprotocol=accepted_subprotocol)
    logger.info(f"Accepted client websocket connection for session {session_id} using subprotocol: {accepted_subprotocol}")

    target_uri = f"ws://127.0.0.1:{port}/ws"

    # 3. Establish a connection to the container's internal ttyd instance with retry safety
    max_retries = 30       # Up to 3 seconds of buffer
    retry_delay = 0.1      # 100ms intervals
    
    try:
        for attempt in range(max_retries):
            try:
                async with websockets.connect(
                    target_uri,
                    subprotocols=[accepted_subprotocol] if accepted_subprotocol else None,
                    ping_interval=None  # Disable automatic pings
                ) as target_ws:
                    logger.info(f"Proxy bridge established to container port {port} on attempt {attempt + 1}")
                    
                    # Forward messages from the internal container to the client
                    async def forward_to_client():
                        try:
                            async for message in target_ws:
                                if isinstance(message, str):
                                    await websocket.send_text(message)
                                else:
                                    await websocket.send_bytes(message)
                        except Exception as e:
                            logger.debug(f"Target connection closed or failed for session {session_id}: {e}")
                        finally:
                            try:
                                await websocket.close()
                            except Exception:
                                pass

                    # Forward messages from the client to the internal container
                    async def forward_to_target():
                        nonlocal last_active_start, is_tab_active, is_eval_active
                        try:
                            while True:
                                data = await websocket.receive()
                                if "text" in data:
                                    text_msg = data["text"]
                                    if len(text_msg) > 8192:
                                        text_msg = text_msg[:8192]
                                    
                                    # Check for custom client telemetry signal starting with prefix '2'
                                    if text_msg.startswith("2"):
                                        try:
                                            import json
                                            signal = json.loads(text_msg[1:])
                                            sig_type = signal.get("type")
                                            
                                            if sig_type == "tab_inactive":
                                                if is_tab_active:
                                                    elapsed = int(time.time() - last_active_start)
                                                    current_task_id = signal.get("task_id", 0)
                                                    if email and current_task_id > 0 and is_eval_active:
                                                        await db_manager.add_task_duration(email, current_task_id, elapsed)
                                                    is_tab_active = False
                                                    logger.info(f"User {email} tab went inactive. Logged segment: {elapsed}s")
                                            
                                            elif sig_type == "tab_active":
                                                if not is_tab_active:
                                                    last_active_start = time.time()
                                                    is_tab_active = True
                                                    logger.info(f"User {email} tab went active.")
                                                    
                                            elif sig_type == "telemetry_event":
                                                event_type = signal.get("event_type")
                                                task_id = signal.get("task_id")
                                                if email and event_type:
                                                    await db_manager.log_telemetry_event(email, task_id, event_type)
                                                    logger.info(f"Logged telemetry event '{event_type}' for user {email} on task {task_id}")
                                                    
                                                    # Handle evaluation start to begin tracking
                                                    if event_type == "evaluation_start":
                                                        is_eval_active = True
                                                        last_active_start = time.time()
                                                        logger.info(f"Evaluation started for user {email}. Active timer initialized.")
                                                    
                                                    # Track active duration on task completion
                                                    elif event_type == "task_complete" and is_tab_active:
                                                        elapsed = int(time.time() - last_active_start)
                                                        if task_id and task_id > 0 and is_eval_active:
                                                            await db_manager.add_task_duration(email, task_id, elapsed)
                                                            await db_manager.finalize_task(email, task_id)
                                                            logger.info(f"Saved completed task {task_id} active duration and finalized: {elapsed}s")
                                                        last_active_start = time.time()
                                        except Exception as e:
                                            logger.error(f"Error handling telemetry signal: {e}")
                                        continue # Do not forward signal to terminal container
                                    
                                    await target_ws.send(text_msg)
                                elif "bytes" in data:
                                    bytes_msg = data["bytes"]
                                    if len(bytes_msg) > 8192:
                                        bytes_msg = bytes_msg[:8192]
                                    await target_ws.send(bytes_msg)
                                elif "type" in data and data["type"] == "websocket.disconnect":
                                    break
                        except WebSocketDisconnect:
                            logger.debug(f"Client disconnected websocket for session {session_id}")
                        except Exception as e:
                            logger.debug(f"Client to target connection failed for session {session_id}: {e}")
                        finally:
                            try:
                                await target_ws.close()
                            except Exception:
                                pass

                    # Bidirectional asynchronous loop bridging the connections
                    await asyncio.gather(
                        forward_to_client(),
                        forward_to_target()
                    )
                
                # Break out of the retry loop once the connection closes cleanly
                break
                
            except (websockets.exceptions.InvalidHandshake, ConnectionRefusedError, OSError) as e:
                if attempt == max_retries - 1:
                    logger.error(f"Failed to connect to container on port {port} after {max_retries} attempts: {e}")
                    raise e
                await asyncio.sleep(retry_delay)

    except Exception as e:
        logger.error(f"WebSocket proxy bridge error for session {session_id}: {e}")

    finally:
        # Finalize active duration on disconnect if tab was active
        if email and is_tab_active and is_eval_active:
            elapsed = int(time.time() - last_active_start)
            try:
                user_data = await db_manager.get_or_create_user(email)
                current_task_id = user_data["current_task_index"] + 1
                if current_task_id > 0:
                    await db_manager.add_task_duration(email, current_task_id, elapsed)
                    logger.info(f"Finalized final active segment for user {email}: {elapsed}s on task {current_task_id}")
            except Exception as e:
                logger.error(f"Failed to save final duration segment on disconnect: {e}")

        # 4. Robust cleanup: trigger container stop and remove mapping from state dictionary
        logger.info(f"Vaporizing sandboxed container and closing session state for {session_id}")
        container_manager.remove_session(session_id)
        
        # Ensure client websocket is fully closed
        try:
            await websocket.close()
        except Exception:
            pass
