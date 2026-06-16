# Survey Platform Admin & Deployment Guide

This guide details how to manage the database container, start and stop the application, and download/decrypt the telemetry evaluation reports.

---

## 1. Managing the Database Container

The application uses a PostgreSQL database for storing user telemetry, task events, and survey responses.

### Start the Database
Run the following command to start the PostgreSQL container in detached (background) mode:
```bash
docker compose -f docker-compose.db.yml up -d
```

### Stop the Database (Preserving Data)
To stop the database container without losing your collected data:
```bash
docker compose -f docker-compose.db.yml down -v
```

### Take Down the Database & Wipe All Data (Fresh Start)
To stop the container and completely remove the associated database volumes/telemetry data:
```bash
docker compose -f docker-compose.db.yml down -v
```

---

## 2. Managing the Application

The survey platform backend is a FastAPI orchestrator that starts isolated containers for user terminals.

### Start the Application
First, make sure the database container is running. Then, execute the following command to run the Uvicorn server:
```bash
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
```
*Note: If you have activated the virtual environment (`source .venv/bin/activate`), you can simply run `uvicorn main:app --host 0.0.0.0 --port 8000`.*

### Take Down/Stop the Application
- If running in the **foreground**, press `Ctrl+C` in the terminal session.
- If running in the **background**, find and stop the process listening on port `8000`:
  ```bash
  kill $(lsof -t -i:8000)
  ```

---

## 3. Downloading the Telemetry Report

The evaluation report is dynamically compiled and encrypted on-demand on the server. You can download the self-contained report via the admin export endpoint:

```bash
curl -o report.html "http://localhost:8000/api/admin/export?token=admin_super_secret_token_2026"
```
*(Replace `admin_super_secret_token_2026` with the `ADMIN_TOKEN` configured in your environment or [config.py](file:///home/sandbox-noadmin/PycharmProjects/sentences-user-survey-platform/config.py).)*

---

## 4. Decrypting the Report

To protect participant data, the exported report is encrypted using **AES-GCM (256-bit)**.

### Option A: Interactive Browser Dashboard (Recommended)
1. Double-click or open the downloaded `report.html` in any web browser.
2. You will be greeted by a secure lockscreen.
3. Enter the configured export password (default: `admin_report_password_2026`).
4. Click **Unlock Report**. The browser decrypts the embedded payload using the Web Crypto API and presents the interactive dashboard.

### Option B: Programmatic Decryption (Python CLI)
To extract the raw JSON data programmatically, use this decryption script. It extracts the encrypted payload directly from the HTML and decrypts it with the `cryptography` package:

```python
import base64
import json
import re
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# 1. Read exported HTML and extract ciphertext, salt, and IV
with open("report.html", "r") as f:
    html = f.read()

ciphertext_match = re.search(r'ciphertext:\s*"([^"]+)"', html)
salt_match = re.search(r'salt:\s*"([^"]+)"', html)
iv_match = re.search(r'iv:\s*"([^"]+)"', html)

ciphertext = base64.b64decode(ciphertext_match.group(1))
salt = base64.b64decode(salt_match.group(1))
iv = base64.b64decode(iv_match.group(1))

# 2. Derive decryption key using the password
password = "admin_report_password_2026"  # Replace with your EXPORT_PASSWORD config value
kdf = PBKDF2HMAC(
    algorithm=hashes.SHA256(),
    length=32,
    salt=salt,
    iterations=100000,
)
key = kdf.derive(password.encode())

# 3. Decrypt with AES-GCM
aesgcm = AESGCM(key)
decrypted_bytes = aesgcm.decrypt(iv, ciphertext, None)
decrypted_data = json.loads(decrypted_bytes.decode('utf-8'))

# Print decrypted data
print(json.dumps(decrypted_data, indent=2))
```
