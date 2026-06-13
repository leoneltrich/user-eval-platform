import logging
import uuid
import docker
from typing import Dict, Optional
from pydantic import BaseModel
from config import DOCKER_IMAGE, DOCKER_RUNTIME, CONTAINER_MEM_LIMIT, CONTAINER_CPU_LIMIT, CONTAINER_USER

logger = logging.getLogger("orchestrator.manager")

class ContainerSession(BaseModel):
    session_id: str
    container_id: str
    port: int

class ContainerManager:
    """Manages active container sessions, including creation, inspection, and lifecycle cleanup."""
    def __init__(self):
        try:
            self.client = docker.from_env()
        except Exception as e:
            logger.error(f"Failed to initialize Docker SDK client: {e}")
            raise e
        # In-memory session tracking: session_id -> session details dict
        self._sessions: Dict[str, dict] = {}

    def create_session(self) -> ContainerSession:
        """Spins up a sandboxed, resource-constrained container using gVisor (runsc) and maps ttyd to local interface."""
        session_id = str(uuid.uuid4())
        
        # Calculate nano_cpus based on core limit (nano_cpus = cores * 10^9)
        nano_cpus = int(CONTAINER_CPU_LIMIT * 1_000_000_000)

        try:
            # Launch container
            container = self.client.containers.run(
                image=DOCKER_IMAGE,
                runtime=DOCKER_RUNTIME,
                ports={'7681/tcp': ('127.0.0.1', 0)},  # Bind to an ephemeral port on loopback interface
                mem_limit=CONTAINER_MEM_LIMIT,
                nano_cpus=nano_cpus,
                user=CONTAINER_USER,
                detach=True,
                auto_remove=True
            )
            
            # Refresh details from API to fetch assigned host port mapping
            container.reload()
            
            ports_info = container.attrs.get("NetworkSettings", {}).get("Ports", {})
            ttyd_ports = ports_info.get("7681/tcp")
            
            if not ttyd_ports:
                container.stop()
                raise RuntimeError("Failed to retrieve host port binding from the running container.")
                
            host_port = int(ttyd_ports[0]["HostPort"])
            
            self._sessions[session_id] = {
                "container_id": container.id,
                "port": host_port,
                "container": container
            }
            
            logger.info(f"Session {session_id} successfully created: Container {container.id[:12]} mapped to local port {host_port}")
            return ContainerSession(
                session_id=session_id,
                container_id=container.id,
                port=host_port
            )
            
        except Exception as e:
            logger.error(f"Failed to start container session {session_id}: {e}")
            raise e

    def get_session(self, session_id: str) -> Optional[dict]:
        """Fetch session information for a given session ID."""
        return self._sessions.get(session_id)

    def list_sessions(self) -> Dict[str, dict]:
        """Lists active container sessions."""
        return {
            sid: {"container_id": info["container_id"], "port": info["port"]}
            for sid, info in self._sessions.items()
        }

    def remove_session(self, session_id: str) -> bool:
        """Removes session, stops the active container instance, and cleans up the mapping."""
        session = self._sessions.pop(session_id, None)
        if not session:
            return False
            
        container = session.get("container")
        if container:
            try:
                container.stop()
                logger.info(f"Successfully stopped and removed container for session {session_id}")
            except Exception as e:
                logger.warning(f"Error stopping container for session {session_id}: {e}")
        return True
