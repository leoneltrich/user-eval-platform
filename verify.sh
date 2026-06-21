#!/bin/bash

TASK=$1

if [[ -z "$TASK" ]]; then
    echo "Usage: ./verify.sh [1|2|3|4|5|6]"
    echo "Example: ./verify.sh 1"
    exit 1
fi

# Color definitions
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "=== OPS-SYNC VERIFIER (TASK $TASK) ==="
echo "-------------------------------------"

case $TASK in
    1)
        # Task 1: Create duplicate of /tmp/data in /tmp/misc
        if [ ! -d "/tmp/misc/data" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: Directory '/tmp/misc/data' was not found.${NC}"
            exit 1
        fi

        if [ ! -f "/tmp/misc/data/file1.txt" ] || [ ! -f "/tmp/misc/data/sub/file2.txt" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: Missing files in the duplicated directory.${NC}"
            exit 1
        fi

        # Check content is not empty or corrupted
        CONTENT1=$(cat /tmp/misc/data/file1.txt 2>/dev/null)
        CONTENT2=$(cat /tmp/misc/data/sub/file2.txt 2>/dev/null)
        if [ "$CONTENT1" != "sample data stream" ] || [ "$CONTENT2" != "nested sample data" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: File contents inside the duplicate directory are incorrect.${NC}"
            exit 1
        fi

        echo -e "${GREEN}STATUS: SUCCESS${NC}"
        echo -e "${GREEN}MESSAGE: Directory duplicate successfully created inside /tmp/misc.${NC}"
        ;;

    2)
        # Task 2: Backup /tmp/results/benchmark to /tmp/backup/ if destination is older
        if [ ! -f "/tmp/backup/benchmark" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: '/tmp/backup/benchmark' does not exist.${NC}"
            exit 1
        fi

        # Verify the content has been updated
        CONTENT=$(cat /tmp/backup/benchmark 2>/dev/null)
        if [ "$CONTENT" != "new benchmark results v2" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: Destination file '/tmp/backup/benchmark' does not contain the updated benchmark data.${NC}"
            exit 1
        fi

        # Make sure source file was not deleted
        if [ ! -f "/tmp/results/benchmark" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: Source file '/tmp/results/benchmark' is missing.${NC}"
            exit 1
        fi

        echo -e "${GREEN}STATUS: SUCCESS${NC}"
        echo -e "${GREEN}MESSAGE: Benchmark successfully backed up to /tmp/backup/ with update constraints.${NC}"
        ;;

    3)
        # Task 3: Move numbers.txt from /tmp to /tmp/misc/ updating/overwriting existing
        if [ -f "/tmp/numbers.txt" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: 'numbers.txt' still exists in /tmp. It should be moved, not copied.${NC}"
            exit 1
        fi

        if [ ! -f "/tmp/misc/numbers.txt" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: 'numbers.txt' was not found in /tmp/misc.${NC}"
            exit 1
        fi

        CONTENT=$(cat /tmp/misc/numbers.txt 2>/dev/null)
        if [ "$CONTENT" != "987654321" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: 'numbers.txt' in /tmp/misc was not updated/overwritten with the new content.${NC}"
            exit 1
        fi

        echo -e "${GREEN}STATUS: SUCCESS${NC}"
        echo -e "${GREEN}MESSAGE: 'numbers.txt' successfully moved and updated.${NC}"
        ;;

    4)
        if [ ! -f ".ops-lock" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: Target state origin file '.ops-lock' was not found in the current directory.${NC}"
            exit 1
        fi

        # Check internal keys
        HAS_MODE=$(grep -c "mode=secure" ".ops-lock")
        HAS_ENV=$(grep -c "env=prod" ".ops-lock")

        if [ "$HAS_MODE" -eq 1 ] && [ "$HAS_ENV" -eq 1 ]; then
            echo -e "${GREEN}STATUS: SUCCESS${NC}"
            echo -e "${GREEN}MESSAGE: Matrix initialization successfully validated for production environment.${NC}"
        else
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}DETECTION DELTA:${NC}"
            [ "$HAS_MODE" -ne 1 ] && echo -e "${RED}  - Missing or incorrect key: expected 'mode=secure'${NC}"
            [ "$HAS_ENV" -ne 1 ] && echo -e "${RED}  - Missing or incorrect key: expected 'env=prod'${NC}"
            exit 1
        fi
        ;;

    5)
        if [ ! -f "data.txt" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: Critical file 'data.txt' is missing from the workspace entirely.${NC}"
            exit 1
        fi

        # Check if the last line matches the exact payload
        LAST_LINE=$(tail -n 1 "data.txt")
        if [ "$LAST_LINE" = "[LEGACY-V2]" ]; then
            echo -e "${GREEN}STATUS: SUCCESS${NC}"
            echo -e "${GREEN}MESSAGE: Legacy string payload appended and stream rotation verified.${NC}"
        else
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}DETECTION DELTA:${NC}"
            echo -e "${RED}  - File state unchanged or corrupted. Expected '[LEGACY-V2]' on the final line.${NC}"
            echo -e "${RED}  - Current trailing payload segment: '$LAST_LINE'${NC}"
            exit 1
        fi
        ;;

    6)
        if [ ! -f "clean.log" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: Pipeline export log 'clean.log' was not generated.${NC}"
            exit 1
        fi

        if [ ! -f "data.txt" ]; then
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}ERROR: 'data.txt' was deleted or moved. The task requires an in-place modification.${NC}"
            exit 1
        fi

        # Check if PASSWORD still exists in data.txt
        REMAINING_CREDS=$(grep -n "PASSWORD" "data.txt")

        if [ -z "$REMAINING_CREDS" ]; then
            echo -e "${GREEN}STATUS: SUCCESS${NC}"
            echo -e "${GREEN}MESSAGE: In-place data sanitization and log routing verified.${NC}"
        else
            echo -e "${RED}STATUS: FAILED${NC}"
            echo -e "${RED}DETECTION DELTA:${NC}"
            echo -e "${RED}  - Sensitive credentials still remain inside data.txt on the following lines:${NC}"
            echo -e "${RED}${REMAINING_CREDS}${NC}"
            exit 1
        fi
        ;;

    *)
        echo "Invalid task selection. Please choose 1, 2, 3, 4, 5, or 6."
        exit 1
        ;;
esac