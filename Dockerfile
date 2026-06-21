# Replace 'YOUR_ORIGINAL_BASE_IMAGE:TAG' with the exact image name string 
# stored inside your Python DOCKER_IMAGE variable (e.g., ubuntu:22.04 or alpine:latest)
FROM tsl0922/ttyd:alpine

RUN apk add --no-cache coreutils

# Set the working directory to match your container's configuration
WORKDIR /tmp

# Copy the pre-compiled binary and verification script into the image
COPY ops-sync /usr/local/bin/ops-sync
COPY verify.sh /usr/local/bin/verify.sh
COPY command-finder /usr/local/bin/command-finder
COPY models /usr/share/command-finder/models
COPY local_assistant.db /var/lib/command-finder/local_assistant.db

RUN chmod 777 /var/lib/command-finder
RUN chmod 666 /var/lib/command-finder/local_assistant.db

ENV DATABASE_PATH=/var/lib/command-finder/local_assistant.db

# Ensure both files have execution permissions
RUN chmod +x /usr/local/bin/ops-sync /usr/local/bin/verify.sh

# Create the initial data.txt file required for Tasks 5 and 6 (previously Tasks 2 and 3)
RUN echo -e "# Enterprise Configuration Data Stream\nSYS_ID=99823\nNODE_LOCATION=us-east-1\nADMIN_PASSWORD=SuperSecret123!\nDEBUG_MODE=false\nDB_CONNECTION_STRING=mysql://user:PASSWORD@localhost:3306/db\nLOG_LEVEL=info" > /tmp/data.txt

# Create folders and files for Tasks 1, 2, 3
RUN mkdir -p /tmp/data/sub /tmp/misc /tmp/results /tmp/backup
RUN echo "sample data stream" > /tmp/data/file1.txt
RUN echo "nested sample data" > /tmp/data/sub/file2.txt

# Setup matching files with specific timestamps for Task 2
RUN echo "new benchmark results v2" > /tmp/results/benchmark
RUN echo "old benchmark results v1" > /tmp/backup/benchmark
RUN touch -d "2026-06-20 12:00:00" /tmp/backup/benchmark
RUN touch -d "2026-06-20 13:00:00" /tmp/results/benchmark

# Setup files for Task 3
RUN echo "987654321" > /tmp/numbers.txt
RUN echo "123" > /tmp/misc/numbers.txt

# Ensure the permissions of the newly created files/folders
RUN chmod -R 777 /tmp/data /tmp/misc /tmp/results /tmp/backup /tmp/numbers.txt /tmp/data.txt