import os

# Centralized configuration settings for the terminal orchestrator
DOCKER_IMAGE = os.getenv("DOCKER_IMAGE", "tsl0922/ttyd:alpine")
DOCKER_RUNTIME = os.getenv("DOCKER_RUNTIME", "runsc")
CONTAINER_MEM_LIMIT = os.getenv("CONTAINER_MEM_LIMIT", "1024m")
CONTAINER_CPU_LIMIT = float(os.getenv("CONTAINER_CPU_LIMIT", "4"))  # Fraction of CPU core limit (e.g. 0.5 cores)
CONTAINER_USER = os.getenv("CONTAINER_USER", "1000:1000")  # ID of non-root user to run inside alpine ttyd
