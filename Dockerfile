# Replace 'YOUR_ORIGINAL_BASE_IMAGE:TAG' with the exact image name string 
# stored inside your Python DOCKER_IMAGE variable (e.g., ubuntu:22.04 or alpine:latest)
FROM tsl0922/ttyd:alpine

# Set the working directory to match your container's configuration
WORKDIR /tmp

# Copy the pre-compiled binary and verification script into the image
COPY ops-sync /usr/local/bin/ops-sync
COPY verify.sh /usr/local/bin/verify.sh

# Ensure both files have execution permissions
RUN chmod +x /usr/local/bin/ops-sync /usr/local/bin/verify.sh

# Create the initial data.txt file required for Tasks 2 and 3
RUN echo -e "# Enterprise Configuration Data Stream\nSYS_ID=99823\nNODE_LOCATION=us-east-1\nADMIN_PASSWORD=SuperSecret123!\nDEBUG_MODE=false\nDB_CONNECTION_STRING=mysql://user:PASSWORD@localhost:3306/db\nLOG_LEVEL=info" > /tmp/data.txt

RUN chmod 777 /tmp/data.txt
# (Optional) Ensure the non-root user owns the /tmp files if CONTAINER_USER is not root
# RUN chown -R sandbox:sandbox /tmp