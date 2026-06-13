import logging
import uuid
import docker
from typing import Dict, Optional
from pydantic import BaseModel
from config import DOCKER_IMAGE, DOCKER_RUNTIME, CONTAINER_MEM_LIMIT, CONTAINER_CPU_LIMIT, CONTAINER_USER, SANDBOX_NETWORK_NAME

logger = logging.getLogger("orchestrator.manager")

class ContainerSession(BaseModel):
    session_id: str
    container_id: str
    port: int

class ContainerManager:
    """Manages active container sessions, including creation, inspection, and lifecycle cleanup."""
    def __init__(self):
        try:
            import os
            # Automatically fall back to rootless docker socket if DOCKER_HOST is not set
            if "DOCKER_HOST" not in os.environ:
                uid = os.getuid()
                rootless_socket = f"/run/user/{uid}/docker.sock"
                if os.path.exists(rootless_socket):
                    self.client = docker.DockerClient(base_url=f"unix://{rootless_socket}")
                else:
                    self.client = docker.from_env()
            else:
                self.client = docker.from_env()
        except Exception as e:
            logger.error(f"Failed to initialize Docker SDK client: {e}")
            raise e
        # In-memory session tracking: session_id -> session details dict
        self._sessions: Dict[str, dict] = {}
        self._setup_sandbox_network()

    def create_session(self) -> ContainerSession:
        """Spins up a sandboxed, resource-constrained container using gVisor (runsc) and maps ttyd to local interface."""
        session_id = str(uuid.uuid4())
        
        # Calculate nano_cpus based on core limit (nano_cpus = cores * 10^9)
        nano_cpus = int(CONTAINER_CPU_LIMIT * 1_000_000_000)

        try:
            # Launch container with custom prompt environment
            container = self.client.containers.run(
                image=DOCKER_IMAGE,
                runtime=DOCKER_RUNTIME,
                network=SANDBOX_NETWORK_NAME,  # Connect to isolated network
                ports={'7681/tcp': ('127.0.0.1', 0)},  # Bind to an ephemeral port on loopback interface
                mem_limit=CONTAINER_MEM_LIMIT,
                nano_cpus=nano_cpus,
                user=CONTAINER_USER,
                detach=True,
                auto_remove=True,
                working_dir="/tmp",
                hostname="sandbox",
                environment={
                    "PROMPT_COMMAND": "export PS1='student@sandbox:\\w\\$ '",
                    "PS1": "student@sandbox:\\w\\$ ",
                    "HOME": "/tmp"
                }
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

    def _setup_sandbox_network(self):
        """Idempotently recreates the sandbox network on startup."""
        try:
            net = self.client.networks.get(SANDBOX_NETWORK_NAME)
            logger.info(f"Removing existing network: {SANDBOX_NETWORK_NAME}")
            net.remove()
        except docker.errors.NotFound:
            pass
        except Exception as e:
            logger.warning(f"Could not remove network {SANDBOX_NETWORK_NAME}: {e}")

        logger.info(f"Creating isolated sandbox network: {SANDBOX_NETWORK_NAME}")
        try:
            self.client.networks.create(
                name=SANDBOX_NETWORK_NAME,
                driver="bridge",
                options={
                    "com.docker.network.bridge.enable_icc": "false"  # Disables container-to-container traffic
                }
            )
        except Exception as e:
            # Fallback for rootless environments missing br_netfilter/iptables bridge configurations
            if "restrict inter-container communication" in str(e) or "bridge-nf-call-iptables" in str(e):
                logger.warning(
                    f"Rootless environment does not support ICC restriction (enable_icc=false). "
                    f"Falling back to basic sandbox network. Error: {e}"
                )
                try:
                    self.client.networks.create(
                        name=SANDBOX_NETWORK_NAME,
                        driver="bridge"
                    )
                except Exception as ex:
                    logger.error(f"Failed to create basic sandbox network: {ex}")
                    raise ex
            else:
                logger.error(f"Failed to create sandbox network: {e}")
                raise e

    def clean_up_network(self):
        """Removes the custom sandbox network."""
        try:
            net = self.client.networks.get(SANDBOX_NETWORK_NAME)
            logger.info(f"Cleaning up sandbox network: {SANDBOX_NETWORK_NAME}")
            net.remove()
        except docker.errors.NotFound:
            pass
        except Exception as e:
            logger.warning(f"Failed to clean up sandbox network {SANDBOX_NETWORK_NAME}: {e}")
