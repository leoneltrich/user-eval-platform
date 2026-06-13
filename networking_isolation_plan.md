# Implementation Plan: Rootless Sandbox Network Isolation

This plan outlines the steps to implement secure, isolated, and idempotent networking for the gVisor sandbox containers within a rootless Docker environment.

---

## Phase 1: Idempotent Network Lifecycle Management

We will manage the Docker network lifecycle programmatically within the orchestrator application startup and shutdown events.

### 1. Startup Network Initialization
When the FastAPI application initializes, it will:
1. Query the Docker daemon to check if the custom network `quiz_sandbox_net` exists.
2. If it exists, force-delete it to clear any stale states or configurations.
3. Create a new network with the following properties:
   - **Internal Mode (`internal=True`)**: Restricts outbound internet access completely.
   - **No Inter-Container Communication (ICC)**: Sets `com.docker.network.bridge.enable_icc = "false"` to prevent containers from discovering or communicating with each other.

### 2. Shutdown Cleanup
When the FastAPI application exits, it will clean up the `quiz_sandbox_net` network to leave the host system clean.

---

## Phase 2: Orchestrator Integration Plan

Here is the proposed design for the codebase modifications:

### 1. Network Configuration Constants
Add network configuration variables to [config.py](file:///home/sandbox-noadmin/PycharmProjects/sentences-user-survey-platform/config.py):
```python
SANDBOX_NETWORK_NAME = "quiz_sandbox_net"
```

### 2. Network Manager Methods
Enhance `ContainerManager` in [container_manager.py](file:///home/sandbox-noadmin/PycharmProjects/sentences-user-survey-platform/container_manager.py) to manage the network:

```python
class ContainerManager:
    def __init__(self):
        # ... Docker client initialization ...
        self._setup_sandbox_network()

    def _setup_sandbox_network(self):
        """Idempotently recreates the sandbox network on startup."""
        # 1. Find and delete existing network (if any)
        try:
            net = self.client.networks.get(SANDBOX_NETWORK_NAME)
            logger.info(f"Removing existing network: {SANDBOX_NETWORK_NAME}")
            net.remove()
        except docker.errors.NotFound:
            pass
            
        # 2. Create the secure internal network
        logger.info(f"Creating isolated sandbox network: {SANDBOX_NETWORK_NAME}")
        self.client.networks.create(
            name=SANDBOX_NETWORK_NAME,
            driver="bridge",
            internal=True,  # Disables egress internet routing
            options={
                "com.docker.network.bridge.enable_icc": "false"  # Disables container-to-container traffic
            }
        )

    def clean_up_network(self):
        """Cleans up the network on application exit."""
        # Remove network...
```

### 3. Container Allocation Updates
Update the container runner inside `create_session` to attach to this network:
```python
container = self.client.containers.run(
    image=DOCKER_IMAGE,
    runtime=DOCKER_RUNTIME,
    network=SANDBOX_NETWORK_NAME,  # Connect to the custom network
    ports={'7681/tcp': ('127.0.0.1', 0)},
    ...
)
```

### 4. FastAPI Event Hook Integration
In [main.py](file:///home/sandbox-noadmin/PycharmProjects/sentences-user-survey-platform/main.py), leverage FastAPI Lifespan events to cleanly trigger network teardown:
```python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Already handled by ContainerManager instantiation
    yield
    # Shutdown: Clean up the network
    logger.info("Cleaning up network on shutdown...")
    container_manager.clean_up_network()

app = FastAPI(title="Quiz Terminal Orchestrator API", lifespan=lifespan)
```

---

## Phase 3: Impact on App Functionality

- **Terminal Connectivity**: Port mappings (`7681/tcp -> 127.0.0.1`) remain fully functional because local port forwarding via rootless Docker works independently of the container's egress capabilities.
- **Internet Access**: Sandbox containers will no longer be able to run command-line tools that require internet (e.g., `curl google.com`, `apk add`). This is expected behavior for local command training.
- **Host Security**: The container can no longer query the FastAPI server at `172.17.0.1:8000` because the internal gateway traffic is restricted.
