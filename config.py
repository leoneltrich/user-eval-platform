import os

# Centralized configuration settings for the terminal orchestrator
DOCKER_IMAGE = os.getenv("DOCKER_IMAGE", "tsl0922/ttyd:alpine")
DOCKER_RUNTIME = os.getenv("DOCKER_RUNTIME", "runsc")
CONTAINER_MEM_LIMIT = os.getenv("CONTAINER_MEM_LIMIT", "1024m")
CONTAINER_CPU_LIMIT = float(os.getenv("CONTAINER_CPU_LIMIT", "4"))  # Fraction of CPU core limit (e.g. 0.5 cores)
CONTAINER_USER = os.getenv("CONTAINER_USER", "1000:1000")  # ID of non-root user to run inside alpine ttyd
SANDBOX_NETWORK_NAME = os.getenv("SANDBOX_NETWORK_NAME", "quiz_sandbox_net")

# Database Configuration Settings
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_USER = os.getenv("DB_USER", "eval_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "eval_secure_password_2026")
DB_NAME = os.getenv("DB_NAME", "evaluation_telemetry")

