import logging
import asyncio
from fastapi import FastAPI, HTTPException, status, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import websockets
from container_manager import ContainerManager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("orchestrator.main")

# Instantiate the container manager
container_manager = ContainerManager()

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
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

class SessionStartResponse(BaseModel):
    session_id: str
    status: str

@app.post("/api/start-session", response_model=SessionStartResponse, status_code=status.HTTP_201_CREATED)
async def start_session():
    """Endpoint to trigger the initialization of a new sandboxed container session."""
    try:
        session = container_manager.create_session()
        return SessionStartResponse(session_id=session.session_id, status="started")
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to initialize terminal session: {str(e)}"
        )

@app.get("/api/sessions")
async def get_sessions():
    """Debug endpoint to list all currently running terminal sessions."""
    return container_manager.list_sessions()

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
    # 1. Look up the session ID to fetch the container's randomized host port
    session = container_manager.get_session(session_id)
    if not session:
        # Accept and immediately close the socket if the session is invalid
        await websocket.accept()
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid session ID")
        logger.warning(f"Rejected websocket request: Invalid session_id {session_id}")
        return

    port = session["port"]
    
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
                        try:
                            while True:
                                data = await websocket.receive()
                                if "text" in data:
                                    await target_ws.send(data["text"])
                                elif "bytes" in data:
                                    await target_ws.send(data["bytes"])
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
        # 4. Robust cleanup: trigger container stop and remove mapping from state dictionary
        logger.info(f"Vaporizing sandboxed container and closing session state for {session_id}")
        container_manager.remove_session(session_id)
        
        # Ensure client websocket is fully closed
        try:
            await websocket.close()
        except Exception:
            pass
